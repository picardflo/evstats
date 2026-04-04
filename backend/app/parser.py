"""
Parsing des fichiers XLSX exportés depuis EVSEMaster.

EVSEMaster exporte les sessions de charge avec des colonnes en français.
Ce module :
  1. Charge le fichier en mémoire via pandas
  2. Renomme les colonnes vers des noms normalisés
  3. Valide la présence de toutes les colonnes attendues
  4. Calcule la répartition HC/HP pour chaque session via tariff.py
  5. Retourne une liste de ParsedSession prêtes à être insérées en base

Colonnes attendues dans le XLSX :
  - Numéro d'enregistrement  → record_id  (clé unique, format "Clock XXXXXXXXXX")
  - Numéro de chargeur       → charger_id
  - Quantité de charge (kWh) → energy_kwh
  - Heure de début de charge → start_time (format ISO "YYYY-MM-DD HH:MM:SS")
  - Temps d'arrêt de charge  → end_time   (même format)
  - Durée de charge (min)    → duration_minutes
  - Utilisateur de début     → start_user ("Clock" ou hash RFID)
  - Utilisateur de fin       → end_status ("Pull Plug", "Fix Time", "Power Down" ou hash RFID)
"""

from datetime import datetime
from dataclasses import dataclass
from typing import List
import io

import pandas as pd

from .tariff import compute_tariff, TariffResult


# Mapping colonnes XLSX → noms internes normalisés
COLUMN_MAP = {
    "Numéro d'enregistrement": "record_id",
    "Numéro de chargeur":      "charger_id",
    "Quantité de charge (kWh)": "energy_kwh",
    "Heure de début de charge": "start_time",
    "Temps d'arrêt de charge":  "end_time",
    "Durée de charge (min)":    "duration_minutes",
    "Utilisateur de début":     "start_user",
    "Utilisateur de fin":       "end_status",
}


@dataclass
class ParsedSession:
    """
    Représente une session de charge parsée et enrichie.
    Intermédiaire entre le XLSX brut et le modèle SQLModel.
    """
    record_id: str          # Identifiant unique EVSEMaster
    charger_id: str         # Identifiant de la borne
    start_time: datetime    # Début de session
    end_time: datetime      # Fin de session
    duration_minutes: float # Durée fournie par EVSEMaster (peut différer de end-start)
    energy_kwh: float       # Énergie totale consommée
    cost_eur: float         # Coût calculé (hc_kwh × prix_HC + hp_kwh × prix_HP)
    hc_kwh: float           # Part HC de l'énergie
    hp_kwh: float           # Part HP de l'énergie
    end_status: str         # Motif de fin (Pull Plug, Fix Time, Power Down, RFID)
    start_user: str         # Initiateur (Clock ou hash RFID)


def parse_xlsx(file_bytes: bytes) -> List[ParsedSession]:
    """
    Parse un fichier XLSX EVSEMaster et retourne les sessions enrichies.

    Le calcul tarifaire (HC/HP) est effectué ici avec les tarifs par défaut.
    Si les tarifs en base diffèrent, le coût sera recalculé lors de l'insertion
    dans main.py (endpoint POST /api/import).

    Args:
        file_bytes: Contenu brut du fichier .xlsx

    Returns:
        Liste de ParsedSession (les lignes avec dates invalides sont ignorées)

    Raises:
        ValueError: Si des colonnes attendues sont absentes du fichier
    """
    df = pd.read_excel(io.BytesIO(file_bytes))
    df = df.rename(columns=COLUMN_MAP)

    # Validation de la présence de toutes les colonnes requises
    required = list(COLUMN_MAP.values())
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"Colonnes manquantes dans le fichier : {missing}")

    sessions = []
    for _, row in df.iterrows():
        # Nettoyage des chaînes (EVSEMaster peut laisser des espaces de padding)
        record_id       = str(row["record_id"]).strip()
        charger_id      = str(row["charger_id"]).strip()
        start_user      = str(row["start_user"]).strip()
        end_status      = str(row["end_status"]).strip()
        energy_kwh      = float(row["energy_kwh"])      if pd.notna(row["energy_kwh"])      else 0.0
        duration_minutes = float(row["duration_minutes"]) if pd.notna(row["duration_minutes"]) else 0.0

        start_time = _parse_dt(row["start_time"])
        end_time   = _parse_dt(row["end_time"])

        # Ignorer les lignes avec des dates non parsables
        if start_time is None or end_time is None:
            continue

        # Calcul HC/HP avec les tarifs par défaut
        # (sera recalculé avec les tarifs actifs en base lors de l'import)
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
    """
    Tente de convertir une valeur en datetime.
    Accepte les objets datetime natifs (pandas peut les retourner directement)
    et les chaînes au format ISO 8601 ("YYYY-MM-DD HH:MM:SS").
    Retourne None si la valeur est absente ou non parsable.
    """
    if pd.isna(value):
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value).strip())
    except ValueError:
        return None
