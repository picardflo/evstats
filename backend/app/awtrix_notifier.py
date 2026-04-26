"""
Client HTTP async pour l'horloge Awtrix3.

Envoie trois types de notifications lors des sessions de charge :
  - Début de charge  : notify éphémère (couleur verte, réveil écran)
  - Mise à jour      : custom app persistante "evstats" (énergie + durée, toutes les N min)
  - Fin de charge    : supprime l'app + notify hold (orange, reste jusqu'à bouton)

Activé uniquement si awtrix_enabled=True et awtrix_url configurée dans AlertConfig.
Toutes les erreurs réseau sont attrapées silencieusement (log seulement).
"""

import httpx
from sqlmodel import Session

from .database import engine
from .models import AlertConfig


def _fmt_duration(duration_min: float) -> str:
    h = int(duration_min // 60)
    m = int(duration_min % 60)
    return f"{h}h{m:02d}" if h > 0 else f"{m}min"


async def _get_config() -> AlertConfig | None:
    """Retourne la config si Awtrix est activé et URL renseignée, sinon None."""
    with Session(engine) as db:
        config = db.get(AlertConfig, 1)
    if config and config.awtrix_enabled and config.awtrix_url:
        return config
    return None


async def _post(base_url: str, path: str, payload: dict) -> None:
    url = f"{base_url.rstrip('/')}/api/{path}"
    async with httpx.AsyncClient(timeout=5.0) as client:
        await client.post(url, json=payload)


async def notify_charge_start(charger_name: str, power_w: float) -> None:
    config = await _get_config()
    if not config:
        return
    try:
        kw = power_w / 1000
        await _post(config.awtrix_url, "notify", {
            "text": f"Charge {charger_name} {kw:.1f}kW",
            "color": "#00FF00",
            "duration": 10,
            "wakeup": True,
        })
        print(f"[awtrix] Debut charge : {charger_name} {kw:.1f} kW", flush=True)
    except Exception as e:
        print(f"[awtrix] Erreur notify start : {e}", flush=True)


async def notify_charge_update(charger_name: str, energy_kwh: float, duration_min: float) -> None:
    config = await _get_config()
    if not config:
        return
    try:
        # lifetime = intervalle + marge de 5 min, pour auto-expirer si le poller s'arrête
        lifetime = config.awtrix_update_interval_min * 60 + 300
        await _post(config.awtrix_url, "custom?name=evstats", {
            "text": f"{energy_kwh:.1f}kWh {_fmt_duration(duration_min)}",
            "color": "#00BFFF",
            "lifetime": lifetime,
        })
        print(f"[awtrix] Update : {energy_kwh:.2f} kWh / {_fmt_duration(duration_min)}", flush=True)
    except Exception as e:
        print(f"[awtrix] Erreur update : {e}", flush=True)


async def notify_charge_end(charger_name: str, energy_kwh: float, cost_eur: float, duration_min: float) -> None:
    config = await _get_config()
    if not config:
        return
    try:
        # Supprime l'app persistante avant la notif de fin
        await _post(config.awtrix_url, "custom?name=evstats", {})
        await _post(config.awtrix_url, "notify", {
            "text": f"Fin charge {energy_kwh:.1f}kWh {cost_eur:.2f}EUR {_fmt_duration(duration_min)}",
            "color": "#FF8C00",
            "duration": 30,
            "wakeup": True,
        })
        print(f"[awtrix] Fin charge : {energy_kwh:.2f} kWh / {cost_eur:.2f} EUR", flush=True)
    except Exception as e:
        print(f"[awtrix] Erreur notify end : {e}", flush=True)


async def send_test(url: str) -> bool:
    """Envoie une notification de test. Retourne True si succès."""
    try:
        await _post(url, "notify", {
            "text": "EVSE Stats OK",
            "color": "#00FF00",
            "duration": 5,
            "wakeup": True,
        })
        return True
    except Exception:
        return False
