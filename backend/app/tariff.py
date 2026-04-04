"""
Calcul tarifaire EDF - Option HC + Week-end + Mercredi
- HC semaine : 23h30 → 07h30 (lun, mar, jeu, ven)
- Mercredi   : 100% HC
- Week-end   : 100% HC
- HP semaine : 07h30 → 23h30 (lun, mar, jeu, ven)

Prix par défaut (au 16/03/2026) :
- HC : 17,24 c€/kWh
- HP : 23,05 c€/kWh
"""

from datetime import datetime, timedelta
from dataclasses import dataclass

DEFAULT_PRICE_HC = 0.1724
DEFAULT_PRICE_HP = 0.2305

SLOT_MINUTES = 1


def _is_hc(dt: datetime) -> bool:
    weekday = dt.weekday()  # 0=lun, 2=mer, 5=sam, 6=dim
    if weekday in (5, 6):
        return True
    if weekday == 2:
        return True
    total_minutes = dt.hour * 60 + dt.minute
    hc_start = 23 * 60 + 30
    hc_end = 7 * 60 + 30
    return total_minutes >= hc_start or total_minutes < hc_end


@dataclass
class TariffResult:
    hc_kwh: float
    hp_kwh: float
    cost_eur: float


def compute_tariff(
    start: datetime,
    end: datetime,
    energy_kwh: float,
    price_hc: float = DEFAULT_PRICE_HC,
    price_hp: float = DEFAULT_PRICE_HP,
) -> TariffResult:
    if start >= end or energy_kwh <= 0:
        return TariffResult(hc_kwh=0.0, hp_kwh=0.0, cost_eur=0.0)

    total_duration = (end - start).total_seconds() / 60

    hc_minutes = 0.0
    hp_minutes = 0.0
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
    cost_eur = hc_kwh * price_hc + hp_kwh * price_hp

    return TariffResult(
        hc_kwh=round(hc_kwh, 4),
        hp_kwh=round(hp_kwh, 4),
        cost_eur=round(cost_eur, 4),
    )
