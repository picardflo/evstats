"""
Modèles de données SQLModel (ORM + validation Pydantic).

Tables :
  - charging_sessions : sessions de charge parsées et enrichies
  - import_log        : historique des fichiers importés
  - tariff_config     : tarif actif affiché dans l'UI (singleton id=1, kept for compat)
  - tariff_period     : historique des périodes tarifaires (V2)
  - tariff_rule       : règles HC/HP configurables (singleton id=1) (V2)
  - alert_config      : configuration des alertes de consommation (V2)
  - vehicle           : véhicules électriques avec specs (V2)
  - charger           : bornes de recharge configurées (intégration UDP directe) (V2)
"""

from datetime import datetime, date
from typing import Optional
from sqlmodel import Field, SQLModel


class ChargingSession(SQLModel, table=True):
    """
    Une session de charge importée depuis EVSEMaster.

    La clé de déduplication est `record_id` (numéro d'enregistrement EVSEMaster).
    hc_kwh + hp_kwh ≈ energy_kwh
    cost_eur = hc_kwh × price_hc + hp_kwh × price_hp (tarif de la période)
    """
    id: Optional[int] = Field(default=None, primary_key=True)

    record_id:  str = Field(index=True, unique=True)  # "Clock XXXXXXXXXX"
    charger_id: str

    start_time:       datetime
    end_time:         datetime
    duration_minutes: float  # Fourni par EVSEMaster (peut ≠ end - start)

    energy_kwh: float
    hc_kwh:     float  # Part HC calculée par tariff.py
    hp_kwh:     float  # Part HP calculée par tariff.py
    cost_eur:   float  # Coût = hc_kwh × price_hc + hp_kwh × price_hp

    end_status: str  # "Pull Plug", "Fix Time", "Power Down", "UDP Auto", ou hash RFID
    start_user: str  # "Clock", "UDP Auto", ou hash RFID
    source:     str  = Field(default="xlsx")  # "xlsx" ou "udp" (v1.5.0+)


class ImportLog(SQLModel, table=True):
    """Historique des fichiers XLSX importés."""
    id: Optional[int] = Field(default=None, primary_key=True)

    imported_at:    datetime = Field(default_factory=datetime.now)
    filename:       str
    total_rows:     int
    new_rows:       int
    duplicate_rows: int


class TariffConfig(SQLModel, table=True):
    """
    Tarif actif (singleton id=1) — conservé pour compatibilité ascendante.
    En V2, la source de vérité est TariffPeriod.
    Mis à jour automatiquement quand on ajoute/modifie une période.
    """
    id:         int      = Field(default=1, primary_key=True)
    price_hc:   float    = Field(default=0.1724)
    price_hp:   float    = Field(default=0.2305)
    updated_at: datetime = Field(default_factory=datetime.now)


class TariffPeriod(SQLModel, table=True):
    """
    Période tarifaire EDF avec date d'entrée en vigueur.

    Chaque enregistrement représente un tarif valable depuis `valid_from`
    jusqu'à la date de la période suivante (ou aujourd'hui pour la dernière).

    EDF révise les tarifs ~2 fois par an (février et août).
    Le recalcul des coûts applique automatiquement le bon tarif
    selon la date de début de chaque session.

    Exemple :
      id=1 : valid_from=2024-02-01, price_hc=0.1672, price_hp=0.2247
      id=2 : valid_from=2024-08-01, price_hc=0.1724, price_hp=0.2305
      → sessions avant 2024-08-01 utilisent les tarifs de id=1
    """
    id:         Optional[int] = Field(default=None, primary_key=True)
    valid_from: date           # Date d'entrée en vigueur (incluse)
    price_hc:   float          # €/kWh Heures Creuses
    price_hp:   float          # €/kWh Heures Pleines
    label:      str  = Field(default="")  # Libellé optionnel ex: "Révision février 2026"
    created_at: datetime = Field(default_factory=datetime.now)


class TariffRule(SQLModel, table=True):
    """
    Règles de classification HC/HP (singleton id=1).

    full_hc_days : JSON array de numéros de jour (0=Lun … 6=Dim) entièrement HC
    hc_windows   : JSON array de plages horaires HC
                   [{start_h, start_m, end_h, end_m}, ...]
                   Une plage peut chevaucher minuit (ex : start=23h30, end=07h30).
    label        : libellé libre pour identifier le contrat

    Exemples :
      EDF HC/HP + Week-end + Mercredi :
        full_hc_days = [2, 5, 6]
        hc_windows   = [{"start_h": 23, "start_m": 30, "end_h": 7, "end_m": 30}]
      HC/HP classique (sans mercredi ni week-end) :
        full_hc_days = []
        hc_windows   = [{"start_h": 22, "start_m": 0, "end_h": 6, "end_m": 0}]
    """
    id:           int      = Field(default=1, primary_key=True)
    full_hc_days: str      = Field(default='[2, 5, 6]')
    hc_windows:   str      = Field(default='[{"start_h": 23, "start_m": 30, "end_h": 7, "end_m": 30}]')
    label:        str      = Field(default="EDF HC/HP + Week-end + Mercredi")
    updated_at:   datetime = Field(default_factory=datetime.now)


class Vehicle(SQLModel, table=True):
    """
    Véhicule électrique avec ses spécifications techniques.

    Permet de calculer des métriques au kilomètre :
      - km rechargés = energy_kwh × 1000 / consumption_wh_per_km
      - coût/100km   = cost_eur / km × 100
      - nb "pleins"  = energy_kwh / battery_kwh

    battery_kwh : capacité nette utilisable (ex: LEAF 40kWh = 36 kWh)
    consumption_wh_per_km : consommation réelle (ex: LEAF ≈ 160 Wh/km)
    image_filename : nom du fichier dans /app/data/images/ (vide si pas d'image)
    """
    id:                    Optional[int] = Field(default=None, primary_key=True)
    name:                  str                        # Ex: "Nissan LEAF 40 kWh"
    year:                  Optional[int] = None        # Ex: 2018
    battery_kwh:           float                       # Capacité nette en kWh
    consumption_wh_per_km: float                       # Conso réelle en Wh/km
    image_filename:        str  = Field(default="")    # Nom de fichier image
    is_active:             bool = Field(default=False) # Un seul véhicule actif à la fois
    created_at:            datetime = Field(default_factory=datetime.now)


class Charger(SQLModel, table=True):
    """
    Borne de recharge configurée pour l'intégration UDP directe.

    serial   : numéro de série hex, obtenu automatiquement lors du test de connexion
    src_port : port source UDP de la borne (typiquement 6186), obtenu lors du test
    model    : libellé du modèle (saisi manuellement ou récupéré lors du test)
    firmware : version firmware (optionnel, saisi manuellement)

    Flux UDP :
      1. Attendre broadcast 0x0001 sur port 28376
      2. Authentification (0x8002 → 0x0002 → 0x8001)
      3. Requête statut (0x8004 → 0x0004 : tension, courant, puissance)
    """
    id:         Optional[int] = Field(default=None, primary_key=True)
    name:       str                              # Nom libre ex: "Morec Garage"
    ip:         str                              # Adresse IP de la borne
    password:   str                              # Mot de passe 6 chiffres
    serial:     str      = Field(default="")     # Hex serial (rempli après test)
    src_port:   int      = Field(default=6186)   # Port UDP source de la borne
    model:      str      = Field(default="")     # Modèle (ex: "SQW49")
    firmware:   str      = Field(default="")     # Firmware (ex: "313251.118A0053")
    is_enabled:     bool     = Field(default=True)   # Activer/désactiver le polling
    image_filename: str      = Field(default="")     # Nom de fichier dans /app/data/images/
    last_seen:      Optional[datetime] = None        # Dernière communication réussie
    created_at:     datetime = Field(default_factory=datetime.now)


class AlertConfig(SQLModel, table=True):
    """
    Configuration des alertes de consommation mensuelle (singleton id=1).

    Une alerte est déclenchée (webhook HTTP POST) quand la consommation
    du mois en cours dépasse threshold_kwh ou threshold_eur.

    Le webhook est générique : compatible ntfy, Slack, Discord, etc.
    Pour ntfy : webhook_url = "https://ntfy.sh/mon-topic"
    Pour Slack : webhook_url = "https://hooks.slack.com/services/..."

    last_alert_month : dernier mois où une alerte a été envoyée (évite les doublons).
    """
    id:               int      = Field(default=1, primary_key=True)
    enabled:          bool     = Field(default=False)
    threshold_kwh:    float    = Field(default=0.0)   # 0 = désactivé
    threshold_eur:    float    = Field(default=0.0)   # 0 = désactivé
    webhook_url:      str      = Field(default="")    # URL webhook de notification
    last_alert_month: str      = Field(default="")    # Format "YYYY-MM"
    updated_at:       datetime = Field(default_factory=datetime.now)
