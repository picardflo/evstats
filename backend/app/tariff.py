"""
Moteur de calcul tarifaire EDF.

Option souscrite : Heures Creuses + Week-end + Mercredi (12 kVA)

Règles de classification HC/HP :
  - Mercredi         → 100% Heures Creuses (toute la journée)
  - Samedi/Dimanche  → 100% Heures Creuses (toute la journée)
  - Lun/Mar/Jeu/Ven  → HC si 23h30 ≤ t < 07h30, HP sinon

Algorithme :
  La session est découpée en tranches de SLOT_MINUTES minutes.
  Chaque tranche est classée HC ou HP selon _is_hc().
  L'énergie (kWh) est répartie proportionnellement à la durée HC/HP.

Tarifs par défaut (au 16/03/2026) :
  HC : 17,24 c€/kWh  →  0,1724 €/kWh
  HP : 23,05 c€/kWh  →  0,2305 €/kWh

Note : les tarifs sont stockés en base (TariffConfig) et modifiables
via l'interface. Les valeurs ci-dessous servent uniquement à l'init.
"""

from datetime import datetime, timedelta
from dataclasses import dataclass

# ── Tarifs par défaut ────────────────────────────────────────────────────────
DEFAULT_PRICE_HC = 0.1724  # €/kWh — Heures Creuses
DEFAULT_PRICE_HP = 0.2305  # €/kWh — Heures Pleines

# Résolution du découpage temporel (en minutes).
# 1 minute est un bon compromis précision/performance.
# Réduire à 0.5 pour plus de précision sur les sessions à cheval sur 23h30/07h30.
SLOT_MINUTES = 1


def _is_hc(dt: datetime) -> bool:
    """
    Retourne True si l'instant `dt` est classé Heures Creuses.

    Logique :
      - Mercredi (weekday=2)         → HC
      - Week-end (weekday 5=sam, 6=dim) → HC
      - Autres jours : HC si heure >= 23h30 OU heure < 07h30
        (la plage HC chevauche minuit, d'où le OU et non le ET)
    """
    weekday = dt.weekday()  # 0=lun, 1=mar, 2=mer, 3=jeu, 4=ven, 5=sam, 6=dim

    # Mercredi et week-end : 100% HC
    if weekday in (2, 5, 6):
        return True

    # Semaine hors mercredi : plage HC 23h30 → 07h30
    total_minutes = dt.hour * 60 + dt.minute
    hc_start = 23 * 60 + 30  # 1410 min depuis minuit
    hc_end   =  7 * 60 + 30  #  450 min depuis minuit

    return total_minutes >= hc_start or total_minutes < hc_end


@dataclass
class TariffResult:
    """Résultat du calcul tarifaire pour une session."""
    hc_kwh: float   # Énergie consommée en Heures Creuses
    hp_kwh: float   # Énergie consommée en Heures Pleines
    cost_eur: float # Coût total = hc_kwh × price_hc + hp_kwh × price_hp


def compute_tariff(
    start: datetime,
    end: datetime,
    energy_kwh: float,
    price_hc: float = DEFAULT_PRICE_HC,
    price_hp: float = DEFAULT_PRICE_HP,
) -> TariffResult:
    """
    Calcule la répartition HC/HP et le coût d'une session de charge.

    Args:
        start:      Heure de début de la session
        end:        Heure de fin de la session
        energy_kwh: Énergie totale consommée (kWh)
        price_hc:   Prix HC en €/kWh (défaut : tarif EDF en vigueur)
        price_hp:   Prix HP en €/kWh (défaut : tarif EDF en vigueur)

    Returns:
        TariffResult avec hc_kwh, hp_kwh, cost_eur

    Exemple :
        Session mardi 23h00 → mercredi 08h00, 20 kWh
        → 30 min HP (23h00→23h30) + 30 min HC (23h30→00h00)
          + 8h HC (mercredi complet jusqu'à 08h00)
        → très majoritairement HC → coût réduit
    """
    # Cas dégénérés : session invalide ou sans énergie
    if start >= end or energy_kwh <= 0:
        return TariffResult(hc_kwh=0.0, hp_kwh=0.0, cost_eur=0.0)

    total_duration_min = (end - start).total_seconds() / 60

    hc_minutes = 0.0
    hp_minutes = 0.0
    current = start
    slot = timedelta(minutes=SLOT_MINUTES)

    # Parcours minute par minute de la session
    while current < end:
        next_slot = min(current + slot, end)
        slot_duration = (next_slot - current).total_seconds() / 60

        if _is_hc(current):
            hc_minutes += slot_duration
        else:
            hp_minutes += slot_duration

        current = next_slot

    # Répartition proportionnelle de l'énergie selon la durée HC/HP
    hc_ratio = hc_minutes / total_duration_min if total_duration_min > 0 else 0.0
    hp_ratio = hp_minutes / total_duration_min if total_duration_min > 0 else 0.0

    hc_kwh = energy_kwh * hc_ratio
    hp_kwh = energy_kwh * hp_ratio
    cost_eur = hc_kwh * price_hc + hp_kwh * price_hp

    return TariffResult(
        hc_kwh=round(hc_kwh, 4),
        hp_kwh=round(hp_kwh, 4),
        cost_eur=round(cost_eur, 4),
    )
