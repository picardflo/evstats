"""
Moteur de calcul tarifaire.

Les règles de classification HC/HP sont entièrement configurables via TariffRuleConfig.
La configuration par défaut correspond au contrat EDF HC/HP + Week-end + Mercredi (12 kVA).

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
from dataclasses import dataclass, field

# ── Tarifs par défaut ────────────────────────────────────────────────────────
DEFAULT_PRICE_HC = 0.1724  # €/kWh — Heures Creuses
DEFAULT_PRICE_HP = 0.2305  # €/kWh — Heures Pleines

# Résolution du découpage temporel (en minutes).
# 1 minute est un bon compromis précision/performance.
SLOT_MINUTES = 1


# ── Configuration des règles HC/HP ───────────────────────────────────────────

@dataclass
class HcWindow:
    """
    Plage horaire Heures Creuses (peut chevaucher minuit).

    Exemple : 23h30 → 07h30 : start_h=23, start_m=30, end_h=7, end_m=30
    Exemple : 00h00 → 07h00 : start_h=0,  start_m=0,  end_h=7, end_m=0
    """
    start_h: int
    start_m: int
    end_h:   int
    end_m:   int


@dataclass
class TariffRuleConfig:
    """
    Configuration des règles de classification HC/HP.

    full_hc_days : numéros de jours de semaine entièrement en HC
                   (0=Lun, 1=Mar, 2=Mer, 3=Jeu, 4=Ven, 5=Sam, 6=Dim)
    hc_windows   : plages horaires HC applicables aux jours non couverts par full_hc_days.
                   Plusieurs fenêtres possibles. Une fenêtre peut chevaucher minuit
                   (ex : 23h30→07h30).

    Exemples de configurations :
      EDF HC/HP + Week-end + Mercredi (défaut) :
        full_hc_days = [2, 5, 6]
        hc_windows   = [HcWindow(23, 30, 7, 30)]

      HC/HP classique (sans mercredi ni week-end) :
        full_hc_days = []
        hc_windows   = [HcWindow(22, 0, 6, 0)]

      Deux plages HC par jour :
        full_hc_days = []
        hc_windows   = [HcWindow(0, 0, 7, 0), HcWindow(12, 0, 14, 0)]
    """
    full_hc_days: list = field(default_factory=lambda: [2, 5, 6])
    hc_windows:   list = field(default_factory=lambda: [
        HcWindow(start_h=23, start_m=30, end_h=7, end_m=30)
    ])


# Règle par défaut : EDF HC/HP + Week-end + Mercredi
DEFAULT_RULE = TariffRuleConfig()


# ── Moteur ───────────────────────────────────────────────────────────────────

def _is_hc(dt: datetime, rule: TariffRuleConfig = DEFAULT_RULE) -> bool:
    """
    Retourne True si l'instant `dt` est classé Heures Creuses.

    Logique :
      1. Si le jour de semaine est dans full_hc_days → HC toute la journée.
      2. Sinon, parcourt les hc_windows. Si dt tombe dans une plage → HC.
         Une plage chevauchant minuit (start > end) utilise un OR (ex: 23h30→07h30).
         Une plage intra-journalière (start < end) utilise un AND (ex: 12h00→14h00).
      3. Aucune plage correspondante → HP.
    """
    weekday = dt.weekday()  # 0=lun … 6=dim

    if weekday in rule.full_hc_days:
        return True

    total_minutes = dt.hour * 60 + dt.minute
    for w in rule.hc_windows:
        start = w.start_h * 60 + w.start_m
        end   = w.end_h   * 60 + w.end_m
        if start > end:  # Chevauche minuit (ex : 23h30 → 07h30)
            if total_minutes >= start or total_minutes < end:
                return True
        else:            # Plage intra-journalière (ex : 12h00 → 14h00)
            if start <= total_minutes < end:
                return True
    return False


@dataclass
class TariffResult:
    """Résultat du calcul tarifaire pour une session."""
    hc_kwh:   float  # Énergie consommée en Heures Creuses
    hp_kwh:   float  # Énergie consommée en Heures Pleines
    cost_eur: float  # Coût total = hc_kwh × price_hc + hp_kwh × price_hp


def compute_tariff(
    start:      datetime,
    end:        datetime,
    energy_kwh: float,
    price_hc:   float = DEFAULT_PRICE_HC,
    price_hp:   float = DEFAULT_PRICE_HP,
    rule:       TariffRuleConfig = DEFAULT_RULE,
) -> TariffResult:
    """
    Calcule la répartition HC/HP et le coût d'une session de charge.

    Args:
        start:      Heure de début de la session
        end:        Heure de fin de la session
        energy_kwh: Énergie totale consommée (kWh)
        price_hc:   Prix HC en €/kWh (défaut : tarif EDF en vigueur)
        price_hp:   Prix HP en €/kWh (défaut : tarif EDF en vigueur)
        rule:       Règles de classification HC/HP (défaut : EDF Mercredi + WE)

    Returns:
        TariffResult avec hc_kwh, hp_kwh, cost_eur

    Exemple :
        Session mardi 23h00 → mercredi 08h00, 20 kWh, règle EDF défaut
        → 30 min HP (23h00→23h30) + 30 min HC (23h30→00h00)
          + 8h HC (mercredi complet jusqu'à 08h00)
        → très majoritairement HC → coût réduit
    """
    if start >= end or energy_kwh <= 0:
        return TariffResult(hc_kwh=0.0, hp_kwh=0.0, cost_eur=0.0)

    total_duration_min = (end - start).total_seconds() / 60

    hc_minutes = 0.0
    hp_minutes = 0.0
    current = start
    slot = timedelta(minutes=SLOT_MINUTES)

    # Parcours minute par minute de la session
    while current < end:
        next_slot    = min(current + slot, end)
        slot_duration = (next_slot - current).total_seconds() / 60

        if _is_hc(current, rule):
            hc_minutes += slot_duration
        else:
            hp_minutes += slot_duration

        current = next_slot

    # Répartition proportionnelle de l'énergie selon la durée HC/HP
    hc_ratio = hc_minutes / total_duration_min if total_duration_min > 0 else 0.0
    hp_ratio = hp_minutes / total_duration_min if total_duration_min > 0 else 0.0

    hc_kwh   = energy_kwh * hc_ratio
    hp_kwh   = energy_kwh * hp_ratio
    cost_eur = hc_kwh * price_hc + hp_kwh * price_hp

    return TariffResult(
        hc_kwh=round(hc_kwh, 4),
        hp_kwh=round(hp_kwh, 4),
        cost_eur=round(cost_eur, 4),
    )
