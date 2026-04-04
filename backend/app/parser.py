"""
Parsing du fichier XLSX exporté depuis EVSEMaster.

Colonnes attendues :
  - Numéro d'enregistrement
  - Numéro de chargeur
  - Quantité de charge (kWh)
  - Heure de début de charge
  - Temps d'arrêt de charge
  - Durée de charge (min)
  - Utilisateur de début
  - Utilisateur de fin
"""

from datetime import datetime
from dataclasses import dataclass
from typing import List
import io

import pandas as pd

from .tariff import compute_tariff, TariffResult


COLUMN_MAP = {
    "Numéro d'enregistrement": "record_id",
    "Numéro de chargeur": "charger_id",
    "Quantité de charge (kWh)": "energy_kwh",
    "Heure de début de charge": "start_time",
    "Temps d'arrêt de charge": "end_time",
    "Durée de charge (min)": "duration_minutes",
    "Utilisateur de début": "start_user",
    "Utilisateur de fin": "end_status",
}


@dataclass
class ParsedSession:
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


def parse_xlsx(file_bytes: bytes) -> List[ParsedSession]:
    df = pd.read_excel(io.BytesIO(file_bytes))
    df = df.rename(columns=COLUMN_MAP)

    required = list(COLUMN_MAP.values())
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"Colonnes manquantes dans le fichier : {missing}")

    sessions = []
    for _, row in df.iterrows():
        record_id = str(row["record_id"]).strip()
        charger_id = str(row["charger_id"]).strip()
        energy_kwh = float(row["energy_kwh"]) if pd.notna(row["energy_kwh"]) else 0.0
        duration_minutes = float(row["duration_minutes"]) if pd.notna(row["duration_minutes"]) else 0.0
        start_user = str(row["start_user"]).strip()
        end_status = str(row["end_status"]).strip()

        start_time = _parse_dt(row["start_time"])
        end_time = _parse_dt(row["end_time"])

        if start_time is None or end_time is None:
            continue

        tariff: TariffResult = compute_tariff(start_time, end_time, energy_kwh)

        sessions.append(ParsedSession(
            record_id=record_id,
            charger_id=charger_id,
            start_time=start_time,
            end_time=end_time,
            duration_minutes=duration_minutes,
            energy_kwh=energy_kwh,
            cost_eur=tariff.cost_eur,
            hc_kwh=tariff.hc_kwh,
            hp_kwh=tariff.hp_kwh,
            end_status=end_status,
            start_user=start_user,
        ))

    return sessions


def _parse_dt(value) -> datetime | None:
    if pd.isna(value):
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value).strip())
    except ValueError:
        return None
