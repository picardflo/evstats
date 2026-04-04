from datetime import datetime
from typing import Optional
from sqlmodel import Field, SQLModel


class ChargingSession(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    record_id: str = Field(index=True, unique=True)
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


class ImportLog(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    imported_at: datetime = Field(default_factory=datetime.utcnow)
    filename: str
    total_rows: int
    new_rows: int
    duplicate_rows: int


class TariffConfig(SQLModel, table=True):
    id: int = Field(default=1, primary_key=True)
    price_hc: float = Field(default=0.1724)  # €/kWh
    price_hp: float = Field(default=0.2305)  # €/kWh
    updated_at: datetime = Field(default_factory=datetime.utcnow)
