"""
Poller asyncio pour les bornes EVSE — tourne en arrière-plan.

Rôles :
  1. Maintenir un cache du statut de chaque borne (tension, courant, puissance)
  2. Détecter le début et la fin des sessions de charge
  3. Enregistrer automatiquement les sessions terminées en base de données

Architecture :
  - Une boucle asyncio unique tourne en permanence (démarrée dans le lifespan FastAPI)
  - Chaque itération interroge toutes les bornes activées et avec serial connu
  - Le verrou `udp_lock` (asyncio.Lock) est partagé avec les endpoints manuels
    → évite deux sessions UDP simultanées
  - Le cache `status_cache` est lu par GET /api/chargers/{id}/live (zéro UDP)

Intégration d'énergie :
  - Méthode des trapèzes : energie += (P_n-1 + P_n) / 2 × Δt
  - Précision suffisante pour un usage domestique (~±5% selon interval de poll)

Détection fin de session :
  - 3 lectures consécutives avec courant < 0.1A → fin confirmée
  - Évite les faux négatifs sur brèves coupures de courant
"""

import asyncio
import json
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional

from sqlmodel import Session, select

from .database import engine
from .models import Charger, ChargingSession, TariffPeriod, TariffRule
from .tariff import TariffRuleConfig, HcWindow, compute_tariff, DEFAULT_PRICE_HC, DEFAULT_PRICE_HP
from . import udp_client

# Fichier de persistance des sessions actives (survit aux restarts)
_ACTIVE_CHARGES_FILE = Path("/app/data/active_charges.json")


# ── Seuils ────────────────────────────────────────────────────────────────────

CHARGE_START_A      = 0.5   # Courant min pour démarrer une session (A)
CHARGE_END_A        = 0.1   # Courant max pour considérer fin de charge (A)
CHARGE_END_CONFIRMS = 3     # Lectures consécutives à 0 pour confirmer la fin
POLL_IDLE_S         = 30    # Pause entre polls en veille (s)
POLL_CHARGING_S     = 0     # Pas de pause supplémentaire pendant la charge


# ── Verrou UDP partagé ────────────────────────────────────────────────────────

# Ce verrou est importé par main.py pour les endpoints manuels.
# Une seule session UDP à la fois (contrainte protocolaire EVSEMaster).
udp_lock = asyncio.Lock()


# ── Types ─────────────────────────────────────────────────────────────────────

@dataclass
class ChargerStatusEntry:
    """Entrée du cache de statut d'une borne."""
    voltage:     Optional[float]    = None
    current:     Optional[float]    = None
    power_w:     Optional[float]    = None
    is_charging: bool               = False
    updated_at:  Optional[datetime] = None
    error:       Optional[str]      = None


@dataclass
class ActiveCharge:
    """État d'une session de charge en cours."""
    charger_id:         int
    start_time:         datetime
    energy_wh:          float            = 0.0
    last_poll_time:     Optional[datetime] = None
    last_power_w:       float            = 0.0
    zero_current_count: int              = 0   # lectures consécutives avec I≈0


@dataclass
class ChargerSnapshot:
    """Snapshot immuable d'une borne (évite les DetachedInstanceError SQLModel)."""
    id:       int
    name:     str
    ip:       str
    password: str
    serial:   str
    src_port: int


# ── État global ───────────────────────────────────────────────────────────────

# Cache lu par les endpoints /live (pas de requête UDP)
status_cache: Dict[int, ChargerStatusEntry] = {}

# Sessions de charge en cours
_active_charges: Dict[int, ActiveCharge] = {}

# Tâche asyncio
_poller_task: Optional[asyncio.Task] = None


# ── Helpers tarifaires (dupliqués ici pour éviter l'import circulaire main.py) ──

def _get_tariff_for_date(db: Session, session_date) -> tuple:
    periods = db.exec(
        select(TariffPeriod).order_by(TariffPeriod.valid_from.desc())
    ).all()
    for period in periods:
        if period.valid_from <= session_date:
            return period.price_hc, period.price_hp
    if periods:
        return periods[-1].price_hc, periods[-1].price_hp
    return DEFAULT_PRICE_HC, DEFAULT_PRICE_HP


def _get_tariff_rule_config(db: Session) -> TariffRuleConfig:
    rule = db.get(TariffRule, 1)
    if rule is None:
        return TariffRuleConfig()
    try:
        days = json.loads(rule.full_hc_days)
        raw_windows = json.loads(rule.hc_windows)
        windows = [HcWindow(**w) for w in raw_windows]
        return TariffRuleConfig(full_hc_days=days, hc_windows=windows)
    except Exception:
        return TariffRuleConfig()


# ── Persistance des sessions actives (survit aux restarts) ───────────────────

def _persist_active_charges():
    """Sauvegarde _active_charges sur disque (JSON)."""
    try:
        data = {
            str(cid): {
                "charger_id": c.charger_id,
                "start_time": c.start_time.isoformat(),
                "energy_wh":  c.energy_wh,
                "last_power_w": c.last_power_w,
            }
            for cid, c in _active_charges.items()
        }
        _ACTIVE_CHARGES_FILE.write_text(json.dumps(data))
    except Exception as e:
        print(f"[poller] Impossible de persister active_charges : {e}", flush=True)


def _restore_active_charges():
    """Restaure _active_charges depuis le fichier JSON au démarrage."""
    if not _ACTIVE_CHARGES_FILE.exists():
        return
    try:
        data = json.loads(_ACTIVE_CHARGES_FILE.read_text())
        for cid_str, d in data.items():
            cid = int(cid_str)
            _active_charges[cid] = ActiveCharge(
                charger_id=d["charger_id"],
                start_time=datetime.fromisoformat(d["start_time"]),
                energy_wh=d["energy_wh"],
                last_power_w=d.get("last_power_w", 0.0),
            )
        print(f"[poller] Sessions actives restaurées : {list(_active_charges.keys())}", flush=True)
    except Exception as e:
        print(f"[poller] Impossible de restaurer active_charges : {e}", flush=True)


# ── Sauvegarde de session ─────────────────────────────────────────────────────

def _save_charge_session(charger: ChargerSnapshot, charge: ActiveCharge, end_time: datetime):
    """Enregistre une session de charge UDP terminée en base de données."""
    energy_kwh = round(charge.energy_wh / 1000, 4)
    if energy_kwh < 0.01:
        print(f"[poller] Session trop courte ({energy_kwh:.4f} kWh) sur borne {charger.id} — ignorée", flush=True)
        return

    duration_minutes = round((end_time - charge.start_time).total_seconds() / 60, 1)
    record_id = f"UDP-{charger.id}-{charge.start_time.strftime('%Y%m%d%H%M%S')}"

    with Session(engine) as db:
        existing = db.exec(
            select(ChargingSession).where(ChargingSession.record_id == record_id)
        ).first()
        if existing:
            print(f"[poller] Session {record_id} déjà enregistrée — ignorée", flush=True)
            return

        rule_config   = _get_tariff_rule_config(db)
        tariff_result = compute_tariff(charge.start_time, end_time, energy_kwh, rule=rule_config)
        price_hc, price_hp = _get_tariff_for_date(db, charge.start_time.date())
        cost_eur = round(tariff_result.hc_kwh * price_hc + tariff_result.hp_kwh * price_hp, 4)

        session = ChargingSession(
            record_id=record_id,
            charger_id=charger.name,
            start_time=charge.start_time,
            end_time=end_time,
            duration_minutes=duration_minutes,
            energy_kwh=energy_kwh,
            hc_kwh=tariff_result.hc_kwh,
            hp_kwh=tariff_result.hp_kwh,
            cost_eur=cost_eur,
            end_status="UDP Auto",
            start_user="UDP Auto",
            source="udp",
        )
        db.add(session)
        db.commit()
        print(f"[poller] Session enregistrée : borne={charger.name} "
              f"{charge.start_time.strftime('%H:%M')}→{end_time.strftime('%H:%M')} "
              f"{energy_kwh:.3f} kWh {cost_eur:.4f} €", flush=True)


# ── Traitement du statut reçu ─────────────────────────────────────────────────

def _process_status(charger: ChargerSnapshot, status: dict, poll_time: datetime):
    print(f"[poller] Statut borne {charger.id} : {status}", flush=True)
    """Met à jour le cache et gère la détection de sessions."""
    cid     = charger.id
    current = status.get('current') or 0.0
    power_w = status.get('power_w') or 0.0

    status_cache[cid] = ChargerStatusEntry(
        voltage=status.get('voltage'),
        current=current,
        power_w=power_w,
        is_charging=current > CHARGE_START_A,
        updated_at=poll_time,
    )

    if cid in _active_charges:
        charge = _active_charges[cid]

        # Intégration d'énergie (méthode des trapèzes)
        if charge.last_poll_time:
            dt_h = (poll_time - charge.last_poll_time).total_seconds() / 3600
            charge.energy_wh += (charge.last_power_w + power_w) / 2 * dt_h

        charge.last_poll_time = poll_time
        charge.last_power_w   = power_w

        if current <= CHARGE_END_A:
            charge.zero_current_count += 1
            if charge.zero_current_count >= CHARGE_END_CONFIRMS:
                print(f"[poller] Fin de charge confirmée sur borne {cid} ({charge.energy_wh:.3f} Wh)", flush=True)
                _save_charge_session(charger, charge, poll_time)
                del _active_charges[cid]
                _persist_active_charges()
        else:
            charge.zero_current_count = 0
            _persist_active_charges()

    elif current > CHARGE_START_A:
        print(f"[poller] Début de charge détecté sur borne {cid} ({current:.2f} A)", flush=True)
        _active_charges[cid] = ActiveCharge(
            charger_id=cid,
            start_time=poll_time,
            last_poll_time=poll_time,
            last_power_w=power_w,
        )
        _persist_active_charges()


# ── Poll d'une borne ──────────────────────────────────────────────────────────

async def _poll_once(charger: ChargerSnapshot) -> bool:
    """Interroge une borne, met à jour le cache. Retourne True si succès."""
    try:
        async with udp_lock:
            status = await asyncio.to_thread(
                udp_client.get_status,
                charger.ip,
                charger.serial,
                charger.password,
                charger.src_port,
                15,   # timeout réduit pour le poller
            )
        poll_time = datetime.utcnow()
        _process_status(charger, status, poll_time)

        # Mise à jour last_seen
        with Session(engine) as db:
            c = db.get(Charger, charger.id)
            if c:
                c.last_seen = poll_time
                db.commit()
        return True

    except RuntimeError as e:
        print(f"[poller] Erreur borne {charger.id} : {e}", flush=True)
        # Conserver le dernier statut connu — ne pas écraser is_charging sur erreur transitoire
        prev = status_cache.get(charger.id)
        status_cache[charger.id] = ChargerStatusEntry(
            voltage=prev.voltage if prev else None,
            current=prev.current if prev else None,
            power_w=prev.power_w if prev else None,
            is_charging=prev.is_charging if prev else False,
            updated_at=prev.updated_at if prev else datetime.utcnow(),
            error=str(e),
        )
        return False


# ── Boucle principale ─────────────────────────────────────────────────────────

async def _poller_loop():
    print("[poller] Démarrage du poller UDP", flush=True)
    cycle = 0
    while True:
        try:
            cycle += 1
            print(f"[poller] Cycle {cycle}", flush=True)
            # Charger les bornes activées avec serial connu
            with Session(engine) as db:
                rows = db.exec(
                    select(Charger).where(
                        Charger.is_enabled == True,
                        Charger.serial != "",
                    )
                ).all()
                chargers = [
                    ChargerSnapshot(
                        id=c.id, name=c.name, ip=c.ip,
                        password=c.password, serial=c.serial, src_port=c.src_port,
                    )
                    for c in rows
                ]

            for charger in chargers:
                await _poll_once(charger)
                # Petite pause entre bornes pour laisser respirer l'event loop
                if len(chargers) > 1:
                    await asyncio.sleep(1)

            any_charging = bool(_active_charges)
            sleep_s = POLL_CHARGING_S if any_charging else POLL_IDLE_S
            if sleep_s > 0:
                await asyncio.sleep(sleep_s)

        except asyncio.CancelledError:
            print("[poller] Arrêt du poller UDP", flush=True)
            return
        except Exception as e:
            import traceback
            print(f"[poller] Erreur inattendue : {e}", flush=True)
            traceback.print_exc()
            await asyncio.sleep(30)


# ── Démarrage / arrêt ─────────────────────────────────────────────────────────

def start_poller():
    """Démarre la boucle de polling en arrière-plan (appeler dans le lifespan FastAPI)."""
    global _poller_task
    _restore_active_charges()
    _poller_task = asyncio.create_task(_poller_loop())
    print("[poller] Tâche créée", flush=True)


def stop_poller():
    """Arrête la boucle de polling (appeler à l'arrêt du lifespan)."""
    global _poller_task
    if _poller_task and not _poller_task.done():
        _poller_task.cancel()
    _poller_task = None
