"""
Calcul tarifaire EDF - Option HC + Week-end + Mercredi
- HC semaine : 23h30 → 07h30 (lun, mar, jeu, ven)
- Mercredi   : 100% HC
- Week-end   : 100% HC
- HP semaine : 07h30 → 23h30 (lun, mar, jeu, ven)

Tarifs (c€/kWh) au 16/03/2026 :
- HC : 17,24 c€/kWh
- HP : 23,05 c€/kWh
"""

from datetime import datetime, timedelta
from dataclasses import dataclass

PRICE_HC = 0.1724  # €/kWh
PRICE_HP = 0.2305  # €/kWh

# Résolution du découpage (en minutes)
SLOT_MINUTES = 1


def _is_hc(dt: datetime) -> bool:
    """Retourne True si le moment dt est en Heures Creuses."""
    weekday = dt.weekday()  # 0=lun, 2=mer, 5=sam, 6=dim

    # Week-end → HC
    if weekday in (5, 6):
        return True

    # Mercredi → HC
    if weekday == 2:
        return True

    # Semaine (lun, mar, jeu, ven) : HC entre 23h30 et 07h30
    hour = dt.hour
    minute = dt.minute
    total_minutes = hour * 60 + minute

    hc_start = 23 * 60 + 30  # 23h30
    hc_end = 7 * 60 + 30     # 07h30

    # La plage HC chevauche minuit : >= 23h30 OU < 07h30
    return total_minutes >= hc_start or total_minutes < hc_end


@dataclass
class TariffResult:
    hc_kwh: float
    hp_kwh: float
    cost_eur: float


def compute_tariff(start: datetime, end: datetime, energy_kwh: float) -> TariffResult:
    """
    Découpe la session en tranches d'1 minute et calcule la répartition HC/HP.
    L'énergie est répartie proportionnellement à la durée.
    """
    if start >= end or energy_kwh <= 0:
        return TariffResult(hc_kwh=0.0, hp_kwh=0.0, cost_eur=0.0)

    total_duration = (end - start).total_seconds() / 60  # en minutes

    hc_minutes = 0
    hp_minutes = 0

    current = start
    slot = timedelta(minutes=SLOT_MINUTES)

    while current < end:
        next_slot = min(current + slot, end)
        slot_duration = (next_slot - current).total_seconds() / 60
        if _is_hc(current):
            hc_minutes += slot_duration
        else:
            hp_minutes += slot_duration
        current = next_slot

    hc_ratio = hc_minutes / total_duration if total_duration > 0 else 0
    hp_ratio = hp_minutes / total_duration if total_duration > 0 else 0

    hc_kwh = energy_kwh * hc_ratio
    hp_kwh = energy_kwh * hp_ratio
    cost_eur = hc_kwh * PRICE_HC + hp_kwh * PRICE_HP

    return TariffResult(
        hc_kwh=round(hc_kwh, 4),
        hp_kwh=round(hp_kwh, 4),
        cost_eur=round(cost_eur, 4),
    )
