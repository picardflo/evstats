import csv
import io
from collections import defaultdict
from contextlib import asynccontextmanager
from datetime import datetime, date
from typing import List, Optional

from fastapi import FastAPI, UploadFile, File, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlmodel import Session, select, func

from .database import create_db, get_session
from .models import ChargingSession, ImportLog, TariffConfig
from .parser import parse_xlsx
from .tariff import DEFAULT_PRICE_HC, DEFAULT_PRICE_HP


@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db()
    # Initialise le TariffConfig par défaut s'il n'existe pas
    with next(get_session()) as db:
        cfg = db.get(TariffConfig, 1)
        if cfg is None:
            db.add(TariffConfig(id=1, price_hc=DEFAULT_PRICE_HC, price_hp=DEFAULT_PRICE_HP))
            db.commit()
    yield


app = FastAPI(title="EVSE Stats API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Helpers ─────────────────────────────────────────────────────────────────

def get_tariff(db: Session) -> TariffConfig:
    cfg = db.get(TariffConfig, 1)
    if cfg is None:
        cfg = TariffConfig(id=1, price_hc=DEFAULT_PRICE_HC, price_hp=DEFAULT_PRICE_HP)
    return cfg


# ── Schémas ─────────────────────────────────────────────────────────────────

class ImportResult(BaseModel):
    filename: str
    total_rows: int
    new_rows: int
    duplicate_rows: int


class SessionOut(BaseModel):
    id: int
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

    class Config:
        from_attributes = True


class DailyStats(BaseModel):
    date: str
    energy_kwh: float
    duration_minutes: float
    cost_eur: float
    hc_kwh: float
    hp_kwh: float
    sessions: int
    savings_eur: float  # économie vs 100% HP


class MonthlyStats(BaseModel):
    month: str
    energy_kwh: float
    duration_minutes: float
    cost_eur: float
    hc_kwh: float
    hp_kwh: float
    sessions: int
    savings_eur: float


class SessionsPage(BaseModel):
    total: int
    items: List[SessionOut]


class TariffConfigOut(BaseModel):
    price_hc: float
    price_hp: float
    updated_at: datetime


class TariffConfigIn(BaseModel):
    price_hc: float
    price_hp: float


class RecalcResult(BaseModel):
    updated: int
    price_hc: float
    price_hp: float


# ── Import ───────────────────────────────────────────────────────────────────

@app.post("/api/import", response_model=ImportResult)
async def import_xlsx(
    file: UploadFile = File(...),
    db: Session = Depends(get_session),
):
    if not file.filename or not file.filename.endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Le fichier doit être un .xlsx")

    content = await file.read()
    try:
        parsed = parse_xlsx(content)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    tariff = get_tariff(db)
    new_rows = 0
    duplicate_rows = 0

    for p in parsed:
        existing = db.exec(
            select(ChargingSession).where(ChargingSession.record_id == p.record_id)
        ).first()
        if existing:
            duplicate_rows += 1
            continue

        # Recalcule avec les tarifs actifs en DB
        cost_eur = round(p.hc_kwh * tariff.price_hc + p.hp_kwh * tariff.price_hp, 4)

        session = ChargingSession(
            record_id=p.record_id,
            charger_id=p.charger_id,
            start_time=p.start_time,
            end_time=p.end_time,
            duration_minutes=p.duration_minutes,
            energy_kwh=p.energy_kwh,
            cost_eur=cost_eur,
            hc_kwh=p.hc_kwh,
            hp_kwh=p.hp_kwh,
            end_status=p.end_status,
            start_user=p.start_user,
        )
        db.add(session)
        new_rows += 1

    import_log = ImportLog(
        filename=file.filename,
        total_rows=len(parsed),
        new_rows=new_rows,
        duplicate_rows=duplicate_rows,
    )
    db.add(import_log)
    db.commit()

    return ImportResult(
        filename=file.filename,
        total_rows=len(parsed),
        new_rows=new_rows,
        duplicate_rows=duplicate_rows,
    )


# ── Sessions ─────────────────────────────────────────────────────────────────

@app.get("/api/sessions", response_model=SessionsPage)
def list_sessions(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    end_status: Optional[str] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    db: Session = Depends(get_session),
):
    query = select(ChargingSession)
    if end_status:
        query = query.where(ChargingSession.end_status == end_status)
    if start_date:
        query = query.where(ChargingSession.start_time >= datetime.combine(start_date, datetime.min.time()))
    if end_date:
        query = query.where(ChargingSession.start_time <= datetime.combine(end_date, datetime.max.time()))

    total = db.exec(select(func.count()).select_from(query.subquery())).one()
    query = query.order_by(ChargingSession.start_time.desc()).offset((page - 1) * page_size).limit(page_size)
    items = db.exec(query).all()

    return SessionsPage(total=total, items=items)


@app.get("/api/sessions/export")
def export_sessions_csv(
    end_status: Optional[str] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    db: Session = Depends(get_session),
):
    query = select(ChargingSession)
    if end_status:
        query = query.where(ChargingSession.end_status == end_status)
    if start_date:
        query = query.where(ChargingSession.start_time >= datetime.combine(start_date, datetime.min.time()))
    if end_date:
        query = query.where(ChargingSession.start_time <= datetime.combine(end_date, datetime.max.time()))

    sessions = db.exec(query.order_by(ChargingSession.start_time.desc())).all()

    output = io.StringIO()
    writer = csv.writer(output, delimiter=";")
    writer.writerow(["Début", "Fin", "Durée (min)", "Énergie (kWh)", "HC (kWh)", "HP (kWh)", "Coût (€)", "Statut"])
    for s in sessions:
        writer.writerow([
            s.start_time.strftime("%d/%m/%Y %H:%M"),
            s.end_time.strftime("%d/%m/%Y %H:%M"),
            round(s.duration_minutes, 1),
            round(s.energy_kwh, 3),
            round(s.hc_kwh, 3),
            round(s.hp_kwh, 3),
            round(s.cost_eur, 4),
            s.end_status,
        ])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=sessions.csv"},
    )


# ── Stats ─────────────────────────────────────────────────────────────────────

def _build_stats(sessions, key_fn, price_hp):
    buckets = defaultdict(lambda: dict(energy_kwh=0.0, duration_minutes=0.0, cost_eur=0.0, hc_kwh=0.0, hp_kwh=0.0, sessions=0))
    for s in sessions:
        b = buckets[key_fn(s)]
        b["energy_kwh"] += s.energy_kwh
        b["duration_minutes"] += s.duration_minutes
        b["cost_eur"] += s.cost_eur
        b["hc_kwh"] += s.hc_kwh
        b["hp_kwh"] += s.hp_kwh
        b["sessions"] += 1
    result = {}
    for k, b in buckets.items():
        # Économie = ce qu'aurait coûté 100% HP - coût réel
        savings = round(b["energy_kwh"] * price_hp - b["cost_eur"], 4)
        result[k] = {**{kk: round(v, 4) if isinstance(v, float) else v for kk, v in b.items()}, "savings_eur": savings}
    return result


@app.get("/api/stats/daily", response_model=List[DailyStats])
def daily_stats(
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    db: Session = Depends(get_session),
):
    tariff = get_tariff(db)
    query = select(ChargingSession)
    if start_date:
        query = query.where(ChargingSession.start_time >= datetime.combine(start_date, datetime.min.time()))
    if end_date:
        query = query.where(ChargingSession.start_time <= datetime.combine(end_date, datetime.max.time()))

    sessions = db.exec(query).all()
    buckets = _build_stats(sessions, lambda s: s.start_time.date().isoformat(), tariff.price_hp)
    return [DailyStats(date=d, **data) for d, data in sorted(buckets.items())]


@app.get("/api/stats/monthly", response_model=List[MonthlyStats])
def monthly_stats(db: Session = Depends(get_session)):
    tariff = get_tariff(db)
    sessions = db.exec(select(ChargingSession)).all()
    buckets = _build_stats(sessions, lambda s: s.start_time.strftime("%Y-%m"), tariff.price_hp)
    return [MonthlyStats(month=m, **data) for m, data in sorted(buckets.items())]


# ── Config tarifaire ──────────────────────────────────────────────────────────

@app.get("/api/config/tariff", response_model=TariffConfigOut)
def get_tariff_config(db: Session = Depends(get_session)):
    return get_tariff(db)


@app.put("/api/config/tariff", response_model=TariffConfigOut)
def update_tariff_config(body: TariffConfigIn, db: Session = Depends(get_session)):
    cfg = db.get(TariffConfig, 1)
    if cfg is None:
        cfg = TariffConfig(id=1)
        db.add(cfg)
    cfg.price_hc = body.price_hc
    cfg.price_hp = body.price_hp
    cfg.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(cfg)
    return cfg


@app.post("/api/config/tariff/recalculate", response_model=RecalcResult)
def recalculate_costs(db: Session = Depends(get_session)):
    """Recalcule cost_eur pour toutes les sessions avec les tarifs actuels."""
    tariff = get_tariff(db)
    sessions = db.exec(select(ChargingSession)).all()
    for s in sessions:
        s.cost_eur = round(s.hc_kwh * tariff.price_hc + s.hp_kwh * tariff.price_hp, 4)
    db.commit()
    return RecalcResult(updated=len(sessions), price_hc=tariff.price_hc, price_hp=tariff.price_hp)


# ── Imports log ───────────────────────────────────────────────────────────────

@app.get("/api/imports", response_model=List[dict])
def list_imports(db: Session = Depends(get_session)):
    logs = db.exec(select(ImportLog).order_by(ImportLog.imported_at.desc())).all()
    return [
        {
            "id": l.id,
            "filename": l.filename,
            "imported_at": l.imported_at.isoformat(),
            "total_rows": l.total_rows,
            "new_rows": l.new_rows,
            "duplicate_rows": l.duplicate_rows,
        }
        for l in logs
    ]


@app.get("/api/health")
def health():
    return {"status": "ok"}
