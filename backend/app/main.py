"""
API FastAPI — EVSE Stats

Endpoints disponibles :
  POST   /api/import                          Import d'un fichier .xlsx EVSEMaster
  GET    /api/sessions                        Liste paginée + filtres
  GET    /api/sessions/export                 Export CSV
  GET    /api/stats/daily                     Agrégats journaliers
  GET    /api/stats/monthly                   Agrégats mensuels
  GET    /api/stats/hourly                    Fréquence horaire des sessions (V2)
  GET    /api/imports                         Historique des imports
  GET    /api/config/tariff                   Tarif actif
  PUT    /api/config/tariff                   Mise à jour tarif actif (legacy)
  POST   /api/config/tariff/recalculate       Recalcul HC/HP + coûts par période (V2)
  GET    /api/config/tariff/periods           Liste des périodes tarifaires (V2)
  POST   /api/config/tariff/periods           Nouvelle période tarifaire (V2)
  DELETE /api/config/tariff/periods/{id}      Supprime une période (V2)
  GET    /api/config/tariff-rule              Règles HC/HP configurables (V2)
  PUT    /api/config/tariff-rule              Met à jour les règles HC/HP (V2)
  GET    /api/alerts                          Config alertes (V2)
  PUT    /api/alerts                          Met à jour config alertes (V2)
  POST   /api/alerts/check                    Vérifie et envoie alertes si seuil atteint (V2)
  GET    /api/reports/monthly/{year}/{month}  Génère un rapport PDF mensuel (V2)
  GET    /api/vehicles                        Liste des véhicules (V2)
  POST   /api/vehicles                        Crée un véhicule (V2)
  PUT    /api/vehicles/{id}                   Met à jour un véhicule (V2)
  DELETE /api/vehicles/{id}                   Supprime un véhicule (V2)
  POST   /api/vehicles/{id}/set-active        Définit le véhicule actif (V2)
  POST   /api/vehicles/{id}/image             Upload image d'un véhicule (V2)
  GET    /api/vehicles/{id}/image             Sert l'image d'un véhicule (V2)
  GET    /api/health                          Health check
"""

import csv
import io
import json
import httpx
import mimetypes
from pathlib import Path
from collections import defaultdict
from contextlib import asynccontextmanager
from datetime import datetime, date
from typing import List, Optional

from fastapi import FastAPI, UploadFile, File, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlmodel import Session, select, func

from .database import create_db, get_session, engine
from .models import ChargingSession, ImportLog, TariffConfig, TariffPeriod, TariffRule, AlertConfig, Vehicle
from .parser import parse_xlsx
from .tariff import DEFAULT_PRICE_HC, DEFAULT_PRICE_HP, compute_tariff, TariffRuleConfig, HcWindow
from .report import generate_monthly_pdf

# Répertoire de stockage des images véhicules (dans le volume Docker)
IMAGES_DIR = Path("/app/data/images")


# ── Lifecycle ────────────────────────────────────────────────────────────────

def _migrate():
    """
    Migrations SQLite manuelles : ajoute les colonnes manquantes sur les tables existantes.
    SQLModel/SQLAlchemy ne modifie pas les tables déjà créées → nécessaire à chaque ajout de colonne.
    Chaque ALTER TABLE est ignoré silencieusement si la colonne existe déjà.
    """
    from sqlalchemy import text
    migrations = [
        # v1.4.0 : TariffRule (nouvelle table, créée par create_db)
        # v1.4.2 : colonne is_active sur vehicle
        "ALTER TABLE vehicle ADD COLUMN is_active INTEGER NOT NULL DEFAULT 0",
    ]
    with engine.connect() as conn:
        for stmt in migrations:
            try:
                conn.execute(text(stmt))
                conn.commit()
            except Exception:
                pass  # Colonne déjà présente ou table inexistante → ignoré


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Exécuté au démarrage :
      - Crée les tables manquantes
      - Migrations manuelles (nouvelles colonnes)
      - Initialise TariffConfig (singleton) si absent
      - Initialise TariffPeriod avec le tarif par défaut si vide
      - Initialise AlertConfig si absent
    """
    create_db()
    _migrate()
    with next(get_session()) as db:
        # TariffConfig (singleton)
        cfg = db.get(TariffConfig, 1)
        if cfg is None:
            cfg = TariffConfig(id=1, price_hc=DEFAULT_PRICE_HC, price_hp=DEFAULT_PRICE_HP)
            db.add(cfg)

        # TariffPeriod : seed avec les tarifs par défaut si vide
        # L'utilisateur devra ajuster la date et les prix via l'interface Paramètres.
        periods = db.exec(select(TariffPeriod)).all()
        if not periods:
            db.add(TariffPeriod(
                valid_from=date.today(),
                price_hc=cfg.price_hc,
                price_hp=cfg.price_hp,
                label="Tarif initial (à configurer)",
            ))

        # TariffRule (singleton) : règles HC/HP configurables
        rule = db.get(TariffRule, 1)
        if rule is None:
            db.add(TariffRule(id=1))

        # AlertConfig (singleton)
        alert = db.get(AlertConfig, 1)
        if alert is None:
            db.add(AlertConfig(id=1))

        db.commit()

    # Répertoire des images véhicules
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(title="EVSE Stats API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Helpers ──────────────────────────────────────────────────────────────────

def get_tariff(db: Session) -> TariffConfig:
    """Récupère le tarif actif (singleton id=1)."""
    cfg = db.get(TariffConfig, 1)
    if cfg is None:
        cfg = TariffConfig(id=1, price_hc=DEFAULT_PRICE_HC, price_hp=DEFAULT_PRICE_HP)
    return cfg


def get_tariff_for_date(db: Session, session_date: date) -> tuple[float, float]:
    """
    Retourne (price_hc, price_hp) applicables à une session_date donnée.

    Cherche la période dont valid_from est la plus récente ≤ session_date.
    Si aucune période ne précède la date, utilise la plus ancienne disponible.
    """
    periods = db.exec(
        select(TariffPeriod).order_by(TariffPeriod.valid_from.desc())
    ).all()

    for period in periods:
        if period.valid_from <= session_date:
            return period.price_hc, period.price_hp

    # Fallback : prendre la plus ancienne période
    if periods:
        oldest = periods[-1]
        return oldest.price_hc, oldest.price_hp

    return DEFAULT_PRICE_HC, DEFAULT_PRICE_HP


def get_tariff_rule_config(db: Session) -> TariffRuleConfig:
    """
    Charge les règles HC/HP depuis la base et retourne un TariffRuleConfig.
    Fallback sur la règle par défaut si absent ou JSON invalide.
    """
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


def _apply_session_filters(query, end_status, start_date, end_date):
    """Applique les filtres optionnels sur une query ChargingSession."""
    if end_status:
        query = query.where(ChargingSession.end_status == end_status)
    if start_date:
        query = query.where(ChargingSession.start_time >= datetime.combine(start_date, datetime.min.time()))
    if end_date:
        query = query.where(ChargingSession.start_time <= datetime.combine(end_date, datetime.max.time()))
    return query


def _build_stats(sessions: list, key_fn, price_hp: float) -> dict:
    """
    Agrège les sessions par clé (jour ou mois).
    savings_eur = énergie × price_hp - coût réel (gain grâce au contrat HC).
    """
    buckets = defaultdict(lambda: dict(
        energy_kwh=0.0, duration_minutes=0.0, cost_eur=0.0,
        hc_kwh=0.0, hp_kwh=0.0, sessions=0
    ))

    for s in sessions:
        b = buckets[key_fn(s)]
        b["energy_kwh"]       += s.energy_kwh
        b["duration_minutes"] += s.duration_minutes
        b["cost_eur"]         += s.cost_eur
        b["hc_kwh"]           += s.hc_kwh
        b["hp_kwh"]           += s.hp_kwh
        b["sessions"]         += 1

    result = {}
    for k, b in buckets.items():
        savings = round(b["energy_kwh"] * price_hp - b["cost_eur"], 4)
        result[k] = {
            **{kk: round(v, 4) if isinstance(v, float) else v for kk, v in b.items()},
            "savings_eur": savings,
        }
    return result


# ── Schémas de réponse ───────────────────────────────────────────────────────

class ImportResult(BaseModel):
    filename: str
    total_rows: int
    new_rows: int
    duplicate_rows: int


class SessionOut(BaseModel):
    id: int
    record_id: str
    charger_id: str
    start_time: datetime
    end_time: datetime
    duration_minutes: float
    energy_kwh: float
    cost_eur: float
    hc_kwh: float
    hp_kwh: float
    end_status: str
    start_user: str

    class Config:
        from_attributes = True


class DailyStats(BaseModel):
    date: str
    energy_kwh: float
    duration_minutes: float
    cost_eur: float
    hc_kwh: float
    hp_kwh: float
    sessions: int
    savings_eur: float


class MonthlyStats(BaseModel):
    month: str
    energy_kwh: float
    duration_minutes: float
    cost_eur: float
    hc_kwh: float
    hp_kwh: float
    sessions: int
    savings_eur: float


class HourlyStats(BaseModel):
    """Fréquence des sessions par heure de début (0-23)."""
    hour: int
    sessions: int
    energy_kwh: float


class SessionsPage(BaseModel):
    total: int
    items: List[SessionOut]


class TariffConfigOut(BaseModel):
    price_hc: float
    price_hp: float
    updated_at: datetime


class TariffConfigIn(BaseModel):
    price_hc: float
    price_hp: float


class TariffPeriodOut(BaseModel):
    id: int
    valid_from: date
    price_hc: float
    price_hp: float
    label: str
    created_at: datetime

    class Config:
        from_attributes = True


class TariffPeriodIn(BaseModel):
    valid_from: date
    price_hc: float  # €/kWh
    price_hp: float
    label: str = ""


class RecalcResult(BaseModel):
    updated: int
    detail: str


class TariffRuleWindow(BaseModel):
    start_h: int
    start_m: int
    end_h:   int
    end_m:   int


class TariffRuleOut(BaseModel):
    full_hc_days: List[int]
    hc_windows:   List[TariffRuleWindow]
    label:        str
    updated_at:   datetime


class TariffRuleIn(BaseModel):
    full_hc_days: List[int]
    hc_windows:   List[TariffRuleWindow]
    label:        str = ""


class AlertConfigOut(BaseModel):
    enabled: bool
    threshold_kwh: float
    threshold_eur: float
    webhook_url: str
    last_alert_month: str
    updated_at: datetime


class AlertConfigIn(BaseModel):
    enabled: bool
    threshold_kwh: float
    threshold_eur: float
    webhook_url: str


# ── Import ───────────────────────────────────────────────────────────────────

@app.post("/api/import", response_model=ImportResult)
async def import_xlsx(
    file: UploadFile = File(...),
    db: Session = Depends(get_session),
):
    """
    Import d'un fichier .xlsx EVSEMaster.
    Pour chaque session, applique le tarif de la période correspondant
    à la date de début (via get_tariff_for_date).
    """
    if not file.filename or not file.filename.endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Le fichier doit être un .xlsx")

    content = await file.read()
    try:
        parsed = parse_xlsx(content)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    # Règles HC/HP configurées par l'utilisateur
    rule_config = get_tariff_rule_config(db)

    new_rows = 0
    duplicate_rows = 0

    for p in parsed:
        existing = db.exec(
            select(ChargingSession).where(ChargingSession.record_id == p.record_id)
        ).first()
        if existing:
            duplicate_rows += 1
            continue

        # Recalcul HC/HP avec les règles configurées (pas celles du parser par défaut)
        tariff = compute_tariff(p.start_time, p.end_time, p.energy_kwh, rule=rule_config)

        # Tarif applicable selon la date de la session
        price_hc, price_hp = get_tariff_for_date(db, p.start_time.date())
        cost_eur = round(tariff.hc_kwh * price_hc + tariff.hp_kwh * price_hp, 4)

        db.add(ChargingSession(
            record_id=p.record_id,
            charger_id=p.charger_id,
            start_time=p.start_time,
            end_time=p.end_time,
            duration_minutes=p.duration_minutes,
            energy_kwh=p.energy_kwh,
            cost_eur=cost_eur,
            hc_kwh=tariff.hc_kwh,
            hp_kwh=tariff.hp_kwh,
            end_status=p.end_status,
            start_user=p.start_user,
        ))
        new_rows += 1

    db.add(ImportLog(
        filename=file.filename,
        total_rows=len(parsed),
        new_rows=new_rows,
        duplicate_rows=duplicate_rows,
    ))
    db.commit()

    return ImportResult(
        filename=file.filename,
        total_rows=len(parsed),
        new_rows=new_rows,
        duplicate_rows=duplicate_rows,
    )


# ── Sessions ─────────────────────────────────────────────────────────────────

@app.get("/api/sessions", response_model=SessionsPage)
def list_sessions(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    end_status: Optional[str] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    db: Session = Depends(get_session),
):
    query = _apply_session_filters(select(ChargingSession), end_status, start_date, end_date)
    total = db.exec(select(func.count()).select_from(query.subquery())).one()
    query = query.order_by(ChargingSession.start_time.desc()).offset((page - 1) * page_size).limit(page_size)
    return SessionsPage(total=total, items=db.exec(query).all())


@app.get("/api/sessions/export")
def export_sessions_csv(
    end_status: Optional[str] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    db: Session = Depends(get_session),
):
    """Export CSV séparateur point-virgule (compatible Excel FR)."""
    query = _apply_session_filters(select(ChargingSession), end_status, start_date, end_date)
    sessions = db.exec(query.order_by(ChargingSession.start_time.desc())).all()

    output = io.StringIO()
    writer = csv.writer(output, delimiter=";")
    writer.writerow(["Début", "Fin", "Durée (min)", "Énergie (kWh)", "HC (kWh)", "HP (kWh)", "Coût (€)", "Statut"])
    for s in sessions:
        writer.writerow([
            s.start_time.strftime("%d/%m/%Y %H:%M"),
            s.end_time.strftime("%d/%m/%Y %H:%M"),
            round(s.duration_minutes, 1),
            round(s.energy_kwh, 3),
            round(s.hc_kwh, 3),
            round(s.hp_kwh, 3),
            round(s.cost_eur, 4),
            s.end_status,
        ])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=sessions.csv"},
    )


# ── Stats ─────────────────────────────────────────────────────────────────────

@app.get("/api/stats/daily", response_model=List[DailyStats])
def daily_stats(
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    db: Session = Depends(get_session),
):
    tariff = get_tariff(db)
    query = _apply_session_filters(select(ChargingSession), None, start_date, end_date)
    sessions = db.exec(query).all()
    buckets = _build_stats(sessions, lambda s: s.start_time.date().isoformat(), tariff.price_hp)
    return [DailyStats(date=d, **data) for d, data in sorted(buckets.items())]


@app.get("/api/stats/monthly", response_model=List[MonthlyStats])
def monthly_stats(db: Session = Depends(get_session)):
    tariff = get_tariff(db)
    sessions = db.exec(select(ChargingSession)).all()
    buckets = _build_stats(sessions, lambda s: s.start_time.strftime("%Y-%m"), tariff.price_hp)
    return [MonthlyStats(month=m, **data) for m, data in sorted(buckets.items())]


@app.get("/api/stats/hourly", response_model=List[HourlyStats])
def hourly_stats(db: Session = Depends(get_session)):
    """
    Répartition des sessions par heure de début (0-23).
    Utile pour vérifier que les charges se font majoritairement en HC.
    Retourne les 24 heures même si certaines ont 0 session.
    """
    sessions = db.exec(select(ChargingSession)).all()

    buckets = defaultdict(lambda: {"sessions": 0, "energy_kwh": 0.0})
    for s in sessions:
        h = s.start_time.hour
        buckets[h]["sessions"]   += 1
        buckets[h]["energy_kwh"] += s.energy_kwh

    # S'assurer que les 24 heures sont présentes
    return [
        HourlyStats(
            hour=h,
            sessions=buckets[h]["sessions"],
            energy_kwh=round(buckets[h]["energy_kwh"], 3),
        )
        for h in range(24)
    ]


# ── Config tarifaire (legacy) ─────────────────────────────────────────────────

@app.get("/api/config/tariff", response_model=TariffConfigOut)
def get_tariff_config(db: Session = Depends(get_session)):
    return get_tariff(db)


@app.put("/api/config/tariff", response_model=TariffConfigOut)
def update_tariff_config(body: TariffConfigIn, db: Session = Depends(get_session)):
    """
    Met à jour le tarif actif (singleton).
    En V2, préférer POST /api/config/tariff/periods qui crée une période.
    Ici on crée aussi automatiquement une nouvelle période à today.
    """
    cfg = db.get(TariffConfig, 1) or TariffConfig(id=1)
    cfg.price_hc = body.price_hc
    cfg.price_hp = body.price_hp
    cfg.updated_at = datetime.utcnow()
    db.add(cfg)

    # Crée automatiquement une période à partir d'aujourd'hui
    db.add(TariffPeriod(
        valid_from=date.today(),
        price_hc=body.price_hc,
        price_hp=body.price_hp,
        label=f"Mise à jour {date.today().strftime('%d/%m/%Y')}",
    ))
    db.commit()
    db.refresh(cfg)
    return cfg


# ── Périodes tarifaires (V2) ──────────────────────────────────────────────────

@app.get("/api/config/tariff/periods", response_model=List[TariffPeriodOut])
def list_tariff_periods(db: Session = Depends(get_session)):
    """Retourne toutes les périodes tarifaires, de la plus récente à la plus ancienne."""
    periods = db.exec(select(TariffPeriod).order_by(TariffPeriod.valid_from.desc())).all()
    return periods


@app.post("/api/config/tariff/periods", response_model=TariffPeriodOut)
def add_tariff_period(body: TariffPeriodIn, db: Session = Depends(get_session)):
    """
    Ajoute une nouvelle période tarifaire.
    Met aussi à jour TariffConfig si valid_from >= aujourd'hui.
    """
    period = TariffPeriod(
        valid_from=body.valid_from,
        price_hc=body.price_hc,
        price_hp=body.price_hp,
        label=body.label,
    )
    db.add(period)

    # Si la période est présente ou future → mettre à jour le tarif actif
    if body.valid_from <= date.today():
        cfg = db.get(TariffConfig, 1) or TariffConfig(id=1)
        cfg.price_hc = body.price_hc
        cfg.price_hp = body.price_hp
        cfg.updated_at = datetime.utcnow()
        db.add(cfg)

    db.commit()
    db.refresh(period)
    return period


@app.delete("/api/config/tariff/periods/{period_id}")
def delete_tariff_period(period_id: int, db: Session = Depends(get_session)):
    """Supprime une période tarifaire. Interdit de supprimer la dernière."""
    periods = db.exec(select(TariffPeriod)).all()
    if len(periods) <= 1:
        raise HTTPException(status_code=400, detail="Impossible de supprimer la dernière période tarifaire")

    period = db.get(TariffPeriod, period_id)
    if not period:
        raise HTTPException(status_code=404, detail="Période introuvable")

    db.delete(period)
    db.commit()
    return {"ok": True}


@app.get("/api/config/tariff-rule", response_model=TariffRuleOut)
def get_tariff_rule(db: Session = Depends(get_session)):
    """Retourne les règles HC/HP configurées (singleton id=1)."""
    rule = db.get(TariffRule, 1) or TariffRule(id=1)
    return TariffRuleOut(
        full_hc_days=json.loads(rule.full_hc_days),
        hc_windows=[TariffRuleWindow(**w) for w in json.loads(rule.hc_windows)],
        label=rule.label,
        updated_at=rule.updated_at,
    )


@app.put("/api/config/tariff-rule", response_model=TariffRuleOut)
def update_tariff_rule(body: TariffRuleIn, db: Session = Depends(get_session)):
    """
    Met à jour les règles HC/HP.
    Après modification, pensez à relancer le recalcul pour mettre à jour
    les sessions existantes.
    """
    rule = db.get(TariffRule, 1)
    if rule is None:
        rule = TariffRule(id=1)
    rule.full_hc_days = json.dumps(body.full_hc_days)
    rule.hc_windows   = json.dumps([w.model_dump() for w in body.hc_windows])
    rule.label        = body.label
    rule.updated_at   = datetime.utcnow()
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return TariffRuleOut(
        full_hc_days=json.loads(rule.full_hc_days),
        hc_windows=[TariffRuleWindow(**w) for w in json.loads(rule.hc_windows)],
        label=rule.label,
        updated_at=rule.updated_at,
    )


@app.post("/api/config/tariff/recalculate", response_model=RecalcResult)
def recalculate_costs(db: Session = Depends(get_session)):
    """
    Recalcule hc_kwh, hp_kwh ET cost_eur pour toutes les sessions.

    - hc_kwh / hp_kwh : recalculés avec les règles HC/HP actuellement configurées
    - cost_eur        : recalculé avec le tarif historique de la période (valid_from)

    À utiliser après un changement de règles HC/HP ou de tarifs.
    """
    rule_config = get_tariff_rule_config(db)
    sessions    = db.exec(select(ChargingSession)).all()
    for s in sessions:
        tariff     = compute_tariff(s.start_time, s.end_time, s.energy_kwh, rule=rule_config)
        price_hc, price_hp = get_tariff_for_date(db, s.start_time.date())
        s.hc_kwh   = tariff.hc_kwh
        s.hp_kwh   = tariff.hp_kwh
        s.cost_eur = round(tariff.hc_kwh * price_hc + tariff.hp_kwh * price_hp, 4)
    db.commit()
    return RecalcResult(
        updated=len(sessions),
        detail="Recalcul HC/HP + coûts effectué avec règles et tarifs historiques",
    )


# ── Alertes (V2) ──────────────────────────────────────────────────────────────

@app.get("/api/alerts", response_model=AlertConfigOut)
def get_alert_config(db: Session = Depends(get_session)):
    alert = db.get(AlertConfig, 1)
    if not alert:
        alert = AlertConfig(id=1)
    return alert


@app.put("/api/alerts", response_model=AlertConfigOut)
def update_alert_config(body: AlertConfigIn, db: Session = Depends(get_session)):
    alert = db.get(AlertConfig, 1) or AlertConfig(id=1)
    alert.enabled       = body.enabled
    alert.threshold_kwh = body.threshold_kwh
    alert.threshold_eur = body.threshold_eur
    alert.webhook_url   = body.webhook_url
    alert.updated_at    = datetime.utcnow()
    db.add(alert)
    db.commit()
    db.refresh(alert)
    return alert


@app.post("/api/alerts/check")
async def check_alerts(db: Session = Depends(get_session)):
    """
    Vérifie si les seuils de consommation du mois en cours sont dépassés.
    Envoie une notification webhook si c'est le cas (et si pas déjà envoyé ce mois).

    À appeler régulièrement (ex: tâche cron ou appel depuis le frontend au chargement).
    Compatible ntfy.sh, Slack, Discord (POST JSON générique).
    """
    alert = db.get(AlertConfig, 1)
    if not alert or not alert.enabled or not alert.webhook_url:
        return {"sent": False, "reason": "Alertes désactivées ou webhook non configuré"}

    current_month = datetime.utcnow().strftime("%Y-%m")
    if alert.last_alert_month == current_month:
        return {"sent": False, "reason": "Alerte déjà envoyée ce mois"}

    # Calcul de la consommation du mois en cours
    month_start = datetime.strptime(current_month + "-01", "%Y-%m-%d")
    sessions = db.exec(
        select(ChargingSession).where(ChargingSession.start_time >= month_start)
    ).all()

    total_kwh = sum(s.energy_kwh for s in sessions)
    total_eur = sum(s.cost_eur  for s in sessions)

    triggered = False
    messages = []

    if alert.threshold_kwh > 0 and total_kwh >= alert.threshold_kwh:
        messages.append(f"⚡ Consommation mensuelle : {total_kwh:.1f} kWh (seuil : {alert.threshold_kwh:.0f} kWh)")
        triggered = True

    if alert.threshold_eur > 0 and total_eur >= alert.threshold_eur:
        messages.append(f"💶 Coût mensuel : {total_eur:.2f} € (seuil : {alert.threshold_eur:.2f} €)")
        triggered = True

    if not triggered:
        return {"sent": False, "reason": "Seuils non atteints", "total_kwh": total_kwh, "total_eur": total_eur}

    # Envoi du webhook
    message = "\n".join(messages)
    payload = {
        "title": f"🔋 EVSE Stats — Alerte {current_month}",
        "message": message,
        "priority": "high",
    }

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(alert.webhook_url, json=payload)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Webhook échoué : {e}")

    # Mémoriser le mois de la dernière alerte
    alert.last_alert_month = current_month
    db.commit()

    return {"sent": True, "message": message}


# ── Rapport PDF mensuel (V2) ──────────────────────────────────────────────────

@app.get("/api/reports/monthly/{year}/{month}")
def monthly_pdf_report(year: int, month: int, db: Session = Depends(get_session)):
    """
    Génère un rapport PDF pour le mois demandé.
    Contient : résumé KPIs, répartition HC/HP, tableau des sessions.
    """
    if not (1 <= month <= 12):
        raise HTTPException(status_code=400, detail="Mois invalide (1-12)")

    month_str = f"{year}-{month:02d}"
    month_start = datetime(year, month, 1)

    # Mois suivant pour la borne haute
    if month == 12:
        month_end = datetime(year + 1, 1, 1)
    else:
        month_end = datetime(year, month + 1, 1)

    sessions = db.exec(
        select(ChargingSession)
        .where(ChargingSession.start_time >= month_start)
        .where(ChargingSession.start_time < month_end)
        .order_by(ChargingSession.start_time)
    ).all()

    if not sessions:
        raise HTTPException(status_code=404, detail=f"Aucune session pour {month_str}")

    tariff = get_tariff(db)
    pdf_bytes = generate_monthly_pdf(sessions, month_str, tariff)

    filename = f"evstats_{month_str}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ── Historique des imports ────────────────────────────────────────────────────

@app.get("/api/imports", response_model=List[dict])
def list_imports(db: Session = Depends(get_session)):
    logs = db.exec(select(ImportLog).order_by(ImportLog.imported_at.desc())).all()
    return [
        {
            "id":             l.id,
            "filename":       l.filename,
            "imported_at":    l.imported_at.isoformat(),
            "total_rows":     l.total_rows,
            "new_rows":       l.new_rows,
            "duplicate_rows": l.duplicate_rows,
        }
        for l in logs
    ]


# ── Véhicules (V2) ───────────────────────────────────────────────────────────

class VehicleOut(BaseModel):
    id: int
    name: str
    year: Optional[int]
    battery_kwh: float
    consumption_wh_per_km: float
    image_filename: str
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class VehicleIn(BaseModel):
    name: str
    year: Optional[int] = None
    battery_kwh: float       # Capacité nette en kWh (ex: 36 pour la LEAF 40kWh)
    consumption_wh_per_km: float  # Conso réelle en Wh/km (ex: 160)


@app.get("/api/vehicles", response_model=List[VehicleOut])
def list_vehicles(db: Session = Depends(get_session)):
    return db.exec(select(Vehicle).order_by(Vehicle.created_at)).all()


@app.post("/api/vehicles", response_model=VehicleOut)
def create_vehicle(body: VehicleIn, db: Session = Depends(get_session)):
    # Premier véhicule créé → automatiquement actif
    existing = db.exec(select(Vehicle)).all()
    v = Vehicle(**body.model_dump(), is_active=len(existing) == 0)
    db.add(v)
    db.commit()
    db.refresh(v)
    return v


@app.post("/api/vehicles/{vehicle_id}/set-active", response_model=VehicleOut)
def set_active_vehicle(vehicle_id: int, db: Session = Depends(get_session)):
    """
    Définit un véhicule comme actif et désactive tous les autres.
    Un seul véhicule actif à la fois (modèle "imprimante par défaut").
    """
    v = db.get(Vehicle, vehicle_id)
    if not v:
        raise HTTPException(status_code=404, detail="Véhicule introuvable")
    # Désactive tous les véhicules
    for other in db.exec(select(Vehicle)).all():
        other.is_active = False
    # Active celui-ci
    v.is_active = True
    db.commit()
    db.refresh(v)
    return v


@app.put("/api/vehicles/{vehicle_id}", response_model=VehicleOut)
def update_vehicle(vehicle_id: int, body: VehicleIn, db: Session = Depends(get_session)):
    v = db.get(Vehicle, vehicle_id)
    if not v:
        raise HTTPException(status_code=404, detail="Véhicule introuvable")
    for field, value in body.model_dump().items():
        setattr(v, field, value)
    db.commit()
    db.refresh(v)
    return v


@app.delete("/api/vehicles/{vehicle_id}")
def delete_vehicle(vehicle_id: int, db: Session = Depends(get_session)):
    v = db.get(Vehicle, vehicle_id)
    if not v:
        raise HTTPException(status_code=404, detail="Véhicule introuvable")
    # Supprime l'image associée si elle existe
    if v.image_filename:
        img_path = IMAGES_DIR / v.image_filename
        img_path.unlink(missing_ok=True)
    db.delete(v)
    db.commit()
    return {"ok": True}


@app.post("/api/vehicles/{vehicle_id}/image", response_model=VehicleOut)
async def upload_vehicle_image(
    vehicle_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_session),
):
    """
    Upload de la photo du véhicule.
    Formats acceptés : JPEG, PNG, WebP.
    Le fichier est stocké dans /app/data/images/ sous le nom vehicle_{id}.{ext}.
    """
    v = db.get(Vehicle, vehicle_id)
    if not v:
        raise HTTPException(status_code=404, detail="Véhicule introuvable")

    # Validation du type MIME
    allowed = {"image/jpeg", "image/png", "image/webp"}
    content_type = file.content_type or ""
    if content_type not in allowed:
        raise HTTPException(status_code=400, detail="Format accepté : JPEG, PNG ou WebP")

    ext = mimetypes.guess_extension(content_type) or ".jpg"
    if ext == ".jpe":
        ext = ".jpg"

    # Supprime l'ancienne image si elle existe
    if v.image_filename:
        (IMAGES_DIR / v.image_filename).unlink(missing_ok=True)

    filename = f"vehicle_{vehicle_id}{ext}"
    (IMAGES_DIR / filename).write_bytes(await file.read())

    v.image_filename = filename
    db.commit()
    db.refresh(v)
    return v


@app.get("/api/vehicles/{vehicle_id}/image")
def get_vehicle_image(vehicle_id: int, db: Session = Depends(get_session)):
    """Sert l'image du véhicule depuis /app/data/images/."""
    v = db.get(Vehicle, vehicle_id)
    if not v or not v.image_filename:
        raise HTTPException(status_code=404, detail="Pas d'image pour ce véhicule")

    img_path = IMAGES_DIR / v.image_filename
    if not img_path.exists():
        raise HTTPException(status_code=404, detail="Fichier image introuvable")

    media_type = mimetypes.guess_type(str(img_path))[0] or "image/jpeg"
    return StreamingResponse(open(img_path, "rb"), media_type=media_type)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/version")
def version():
    """Retourne la version de l'application lue depuis le fichier VERSION à la racine du repo."""
    version_file = Path(__file__).parent.parent / "VERSION"
    try:
        return {"version": version_file.read_text().strip()}
    except FileNotFoundError:
        return {"version": "unknown"}
