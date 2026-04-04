from contextlib import asynccontextmanager
from datetime import datetime, date
from typing import List, Optional

from fastapi import FastAPI, UploadFile, File, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlmodel import Session, select, func

from .database import create_db, get_session
from .models import ChargingSession, ImportLog
from .parser import parse_xlsx


@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db()
    yield


app = FastAPI(title="EVSE Stats API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Schémas de réponse ──────────────────────────────────────────────────────

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


class MonthlyStats(BaseModel):
    month: str
    energy_kwh: float
    duration_minutes: float
    cost_eur: float
    hc_kwh: float
    hp_kwh: float
    sessions: int


class SessionsPage(BaseModel):
    total: int
    items: List[SessionOut]


# ── Endpoints ───────────────────────────────────────────────────────────────

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

    new_rows = 0
    duplicate_rows = 0

    for p in parsed:
        existing = db.exec(
            select(ChargingSession).where(ChargingSession.record_id == p.record_id)
        ).first()
        if existing:
            duplicate_rows += 1
            continue

        session = ChargingSession(
            record_id=p.record_id,
            charger_id=p.charger_id,
            start_time=p.start_time,
            end_time=p.end_time,
            duration_minutes=p.duration_minutes,
            energy_kwh=p.energy_kwh,
            cost_eur=p.cost_eur,
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

    query = query.order_by(ChargingSession.start_time.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)
    items = db.exec(query).all()

    return SessionsPage(total=total, items=items)


@app.get("/api/stats/daily", response_model=List[DailyStats])
def daily_stats(
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    db: Session = Depends(get_session),
):
    query = select(ChargingSession)
    if start_date:
        query = query.where(ChargingSession.start_time >= datetime.combine(start_date, datetime.min.time()))
    if end_date:
        query = query.where(ChargingSession.start_time <= datetime.combine(end_date, datetime.max.time()))

    sessions = db.exec(query).all()

    # Agrégation par jour en Python (SQLite ne gère pas bien strftime avec datetime)
    from collections import defaultdict
    buckets: dict = defaultdict(lambda: dict(energy_kwh=0.0, duration_minutes=0.0, cost_eur=0.0, hc_kwh=0.0, hp_kwh=0.0, sessions=0))

    for s in sessions:
        day = s.start_time.date().isoformat()
        b = buckets[day]
        b["energy_kwh"] += s.energy_kwh
        b["duration_minutes"] += s.duration_minutes
        b["cost_eur"] += s.cost_eur
        b["hc_kwh"] += s.hc_kwh
        b["hp_kwh"] += s.hp_kwh
        b["sessions"] += 1

    return [
        DailyStats(date=d, **{k: round(v, 4) if isinstance(v, float) else v for k, v in data.items()})
        for d, data in sorted(buckets.items())
    ]


@app.get("/api/stats/monthly", response_model=List[MonthlyStats])
def monthly_stats(
    db: Session = Depends(get_session),
):
    sessions = db.exec(select(ChargingSession)).all()

    from collections import defaultdict
    buckets: dict = defaultdict(lambda: dict(energy_kwh=0.0, duration_minutes=0.0, cost_eur=0.0, hc_kwh=0.0, hp_kwh=0.0, sessions=0))

    for s in sessions:
        month = s.start_time.strftime("%Y-%m")
        b = buckets[month]
        b["energy_kwh"] += s.energy_kwh
        b["duration_minutes"] += s.duration_minutes
        b["cost_eur"] += s.cost_eur
        b["hc_kwh"] += s.hc_kwh
        b["hp_kwh"] += s.hp_kwh
        b["sessions"] += 1

    return [
        MonthlyStats(month=m, **{k: round(v, 4) if isinstance(v, float) else v for k, v in data.items()})
        for m, data in sorted(buckets.items())
    ]


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
