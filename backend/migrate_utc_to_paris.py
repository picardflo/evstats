"""
Migration one-shot : corrige les horodatages UTC → Europe/Paris dans la DB.

À exécuter UNE SEULE FOIS sur la VM après déploiement du fix timezone.
Utilise zoneinfo (stdlib Python 3.9+) pour gérer correctement UTC+1/UTC+2.

Usage :
    docker exec evstats-api python /app/migrate_utc_to_paris.py
"""
import sqlite3
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

DB_PATH = "/app/data/evstats.db"
PARIS = ZoneInfo("Europe/Paris")


def utc_str_to_paris_str(s: str) -> str:
    """Convertit une chaîne ISO datetime UTC (naïve) en heure locale Paris."""
    dt_utc = datetime.fromisoformat(s).replace(tzinfo=timezone.utc)
    dt_paris = dt_utc.astimezone(PARIS).replace(tzinfo=None)
    return dt_paris.isoformat(sep=" ", timespec="seconds")


con = sqlite3.connect(DB_PATH)
cur = con.cursor()

# ── ChargingSession ───────────────────────────────────────────────────────────
cur.execute("SELECT id, start_time, end_time FROM chargingsession")
rows = cur.fetchall()
updated = 0
for row_id, start_time, end_time in rows:
    new_start = utc_str_to_paris_str(start_time)
    new_end   = utc_str_to_paris_str(end_time)
    cur.execute(
        "UPDATE chargingsession SET start_time=?, end_time=? WHERE id=?",
        (new_start, new_end, row_id),
    )
    updated += 1

con.commit()
print(f"[migration] {updated} sessions corrigées UTC → Europe/Paris")

con.close()
print("[migration] Terminé.")
