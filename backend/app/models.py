"""
Modèles de données SQLModel (ORM + validation Pydantic).

SQLModel génère automatiquement les tables SQLite et les schémas Pydantic
à partir de ces classes. Chaque classe avec `table=True` devient une table.

Tables :
  - charging_sessions : sessions de charge parsées et enrichies
  - import_log        : historique des fichiers importés
  - tariff_config     : tarifs EDF actifs (un seul enregistrement, id=1)
"""

from datetime import datetime
from typing import Optional
from sqlmodel import Field, SQLModel


class ChargingSession(SQLModel, table=True):
    """
    Une session de charge importée depuis EVSEMaster.

    La clé de déduplication est `record_id` (numéro d'enregistrement EVSEMaster),
    ce qui permet d'importer plusieurs exports sans créer de doublons.

    hc_kwh + hp_kwh = energy_kwh (à la précision flottante près)
    cost_eur = hc_kwh × price_hc + hp_kwh × price_hp
    """
    id: Optional[int] = Field(default=None, primary_key=True)

    # Identification
    record_id:  str = Field(index=True, unique=True)  # Clé unique EVSEMaster ("Clock XXXXXXXXXX")
    charger_id: str                                    # Numéro de borne

    # Temporel
    start_time: datetime   # Début de session
    end_time:   datetime   # Fin de session
    duration_minutes: float  # Durée fournie par EVSEMaster (peut ≠ end - start)

    # Énergie
    energy_kwh: float  # Total consommé
    hc_kwh:     float  # Part Heures Creuses (calculée par tariff.py)
    hp_kwh:     float  # Part Heures Pleines (calculée par tariff.py)

    # Coût
    cost_eur: float  # Coût calculé avec les tarifs actifs au moment de l'import

    # Statut
    end_status:  str  # Motif de fin : "Pull Plug", "Fix Time", "Power Down", ou hash RFID
    start_user:  str  # Initiateur : "Clock" (programmé) ou hash RFID (carte)


class ImportLog(SQLModel, table=True):
    """
    Historique des fichiers XLSX importés.
    Permet de tracer quand et quoi a été importé, et combien de sessions
    étaient nouvelles vs doublons.
    """
    id: Optional[int] = Field(default=None, primary_key=True)

    imported_at:     datetime = Field(default_factory=datetime.utcnow)
    filename:        str
    total_rows:      int  # Nombre de lignes dans le fichier
    new_rows:        int  # Sessions effectivement insérées
    duplicate_rows:  int  # Sessions ignorées (record_id déjà en base)


class TariffConfig(SQLModel, table=True):
    """
    Configuration tarifaire EDF active.

    Table singleton : un seul enregistrement avec id=1.
    Mis à jour via PUT /api/config/tariff.

    Les prix sont stockés en €/kWh (ex: 0.1724 pour 17,24 c€/kWh).
    L'interface affiche et saisit en c€/kWh pour plus de lisibilité.

    Note V2 : pour gérer les changements bi-annuels de tarifs EDF avec
    application rétroactive correcte, il faudra migrer vers une table
    TariffPeriod(date_from, date_to, price_hc, price_hp).
    """
    id: int = Field(default=1, primary_key=True)

    price_hc:   float = Field(default=0.1724)  # €/kWh — Heures Creuses
    price_hp:   float = Field(default=0.2305)  # €/kWh — Heures Pleines
    updated_at: datetime = Field(default_factory=datetime.utcnow)
