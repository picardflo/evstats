#!/usr/bin/env python3
"""
Scraper ev-database.org → vehicles_db.json

Génère le fichier frontend/public/vehicles_db.json utilisé pour l'autocomplete
dans le formulaire d'ajout de véhicule.

Usage:
    pip install requests beautifulsoup4
    python scripts/scrape_ev_database.py

    # Limiter à N véhicules (test) :
    python scripts/scrape_ev_database.py --limit 10

    # Filtre sur la disponibilité (current = dispo, archive = ancien modèle) :
    python scripts/scrape_ev_database.py --availability current

    # Scraper uniquement la whitelist (top 30 VE marché FR) :
    python scripts/scrape_ev_database.py --whitelist-only

Output:
    frontend/public/vehicles_db.json

Mapping champs ev-database.org → evstats :
    Useable Capacity          → battery_kwh
    Combined - Mild Weather   → consumption_wh_per_km (conso réelle de référence)
    City/Highway/Combined Mild  → wltp_summer_city/highway/mixed_wh_per_km
    City/Highway/Combined Cold  → wltp_winter_city/highway/mixed_wh_per_km
"""

import argparse
import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://ev-database.org"
OUTPUT = Path(__file__).parent.parent / "frontend" / "public" / "vehicles_db.json"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
    "Referer": "https://ev-database.org/",
}
DELAY = 4.0  # secondes entre chaque requête

# Top 30 VE marché français — whitelist (brand, model) en minuscules pour matching souple
WHITELIST = [
    ("tesla",       "model 3 rwd"),
    ("tesla",       "model y rwd"),
    ("tesla",       "model y long range"),
    ("renault",     "zoe 50"),
    ("renault",     "megane"),
    ("dacia",       "spring"),
    ("peugeot",     "e-208"),
    ("peugeot",     "e-2008"),
    ("opel",        "corsa electric"),
    ("citroën",     "ë-c3"),
    ("citroen",     "e-c3"),
    ("fiat",        "500e hatchback"),
    ("volkswagen",  "id.3"),
    ("volkswagen",  "id.4"),
    ("hyundai",     "ioniq 5"),
    ("hyundai",     "ioniq 6"),
    ("kia",         "ev6"),
    ("kia",         "niro ev"),
    ("mg",          "mg4 electric 51"),
    ("mg",          "mg4 electric 64"),
    ("mg",          "mg4 xpower"),
    ("mg",          "mg5"),
    ("mg",          "zs ev long range"),
    ("mg",          "zs ev standard"),
    ("bmw",         "ix3"),
    ("bmw",         "i4 edrive40"),
    ("audi",        "q4 e-tron"),
    ("mercedes",    "eqa"),
    ("mercedes",    "eqb"),
    ("skoda",       "enyaq"),
    ("nissan",      "leaf 40"),
    ("nissan",      "leaf 62"),
    ("volvo",       "ex40"),
    ("byd",         "atto 3"),
    ("mini",        "cooper se"),
]


def filter_whitelist(vehicles: list[dict]) -> list[dict]:
    """Retourne au plus un véhicule par entrée whitelist (premier match)."""
    selected = []
    for wb, wm in WHITELIST:
        for v in vehicles:
            b = v["brand"].lower().strip()
            m = v["model"].lower().strip()
            if wb in b and wm in m:
                selected.append(v)
                break  # un seul par entrée whitelist
    return selected


# Session persistante — réutilise les cookies (PHPSESSID)
SESSION = requests.Session()
SESSION.headers.update(HEADERS)


def fetch(url: str, retries: int = 4) -> BeautifulSoup:
    for attempt in range(retries):
        resp = SESSION.get(url, timeout=15)
        if resp.status_code == 429:
            wait = 30 * (attempt + 1)
            print(f"    ⚠ 429 Too Many Requests — attente {wait}s...")
            time.sleep(wait)
            continue
        resp.raise_for_status()
        return BeautifulSoup(resp.text, "html.parser")
    raise Exception(f"Échec après {retries} tentatives : {url}")


def get_vehicle_urls(availability_filter: str | None, whitelist_only: bool) -> list[dict]:
    """Récupère toutes les URLs de véhicules depuis la page principale."""
    print("Chargement de la liste des véhicules...")
    soup = fetch(BASE_URL)
    items = soup.select(".list-item[data-jplist-item]")

    vehicles = []
    for item in items:
        link = item.select_one("a.title")
        if not link:
            continue

        href = link.get("href", "")
        if not href.startswith("/car/"):
            continue

        # Filtrage disponibilité (current / archive)
        avail_el = item.select_one(".availability")
        availability = ""
        if avail_el:
            if "current" in avail_el.get("class", []):
                availability = "current"
            elif "archive" in avail_el.get("class", []):
                availability = "archive"

        if availability_filter and availability != availability_filter:
            continue

        brand_el = item.select_one(".title span:not(.model):not(.hidden)")
        model_el = item.select_one(".title span.model")
        brand = brand_el.get_text(strip=True) if brand_el else ""
        model = model_el.get_text(strip=True) if model_el else ""
        # Nettoyer l'année dans le modèle ex: "iX3 50 xDrive (MY26)"
        model = re.sub(r"\s*\(MY\d+.*?\)", "", model).strip()

        vehicles.append({
            "url": BASE_URL + href,
            "brand": brand,
            "model": model,
            "availability": availability,
        })

    if whitelist_only:
        vehicles = filter_whitelist(vehicles)
        print(f"  → {len(vehicles)} véhicules trouvés (whitelist)")
    else:
        print(f"  → {len(vehicles)} véhicules trouvés (total)")
    return vehicles


def parse_float(text: str) -> float | None:
    """Extrait un float depuis une chaîne type '39.0 kWh' ou '166 Wh/km'."""
    m = re.search(r"[\d.]+", text.replace(",", "."))
    return float(m.group()) if m else None


def scrape_vehicle(url: str, brand: str, model: str) -> dict | None:
    """Scrape la fiche détail d'un véhicule."""
    try:
        soup = fetch(url)
    except Exception as e:
        print(f"    ✗ Erreur fetch {url} : {e}")
        return None

    result = {"brand": brand, "model": model, "url": url}

    # Années de production
    header = soup.select_one("header.sub-header")
    if header:
        year_span = header.select_one("span:not([style])")
        if year_span:
            result["years"] = year_span.get_text(strip=True)

    # Batterie nette
    battery_section = soup.select_one("#battery")
    if battery_section:
        for row in battery_section.select("tr"):
            cells = row.select("td")
            if len(cells) == 2 and "Useable" in cells[0].get_text():
                result["battery_kwh"] = parse_float(cells[1].get_text())
                break

    # Consommations réelles (Wh/km)
    consumption_section = soup.select_one("#real-consumption")
    if consumption_section:
        for row in consumption_section.select("tr"):
            cells = row.select("td")
            if len(cells) != 2:
                continue
            label = cells[0].get_text(strip=True)
            value = parse_float(cells[1].get_text())
            if value is None:
                continue

            if "City - Mild"     in label: result["wltp_summer_city_wh_per_km"]    = value
            if "Highway - Mild"  in label: result["wltp_summer_highway_wh_per_km"] = value
            if "Combined - Mild" in label: result["wltp_summer_mixed_wh_per_km"]   = value
            if "City - Cold"     in label: result["wltp_winter_city_wh_per_km"]    = value
            if "Highway - Cold"  in label: result["wltp_winter_highway_wh_per_km"] = value
            if "Combined - Cold" in label: result["wltp_winter_mixed_wh_per_km"]   = value

    # Conso réelle = Combined Mild (référence pour KPIs)
    if "wltp_summer_mixed_wh_per_km" in result:
        result["consumption_wh_per_km"] = result["wltp_summer_mixed_wh_per_km"]

    # Valider que les champs essentiels sont présents
    if not result.get("battery_kwh") or not result.get("consumption_wh_per_km"):
        print(f"    ✗ Données incomplètes pour {brand} {model}")
        return None

    return result


def main():
    parser = argparse.ArgumentParser(description="Scrape ev-database.org → vehicles_db.json")
    parser.add_argument("--limit", type=int, default=0, help="Limiter à N véhicules (0 = tous)")
    parser.add_argument("--availability", choices=["current", "archive"], default=None,
                        help="Filtrer par disponibilité (current = modèles actuels)")
    parser.add_argument("--whitelist-only", action="store_true",
                        help="Scraper uniquement le top 30 VE marché français")
    args = parser.parse_args()

    vehicles_meta = get_vehicle_urls(args.availability, args.whitelist_only)

    if args.limit:
        vehicles_meta = vehicles_meta[:args.limit]
        print(f"  → Limité à {args.limit} véhicules")

    # Reprise depuis fichier existant (évite de tout recommencer)
    results = []
    already_scraped = set()
    if OUTPUT.exists():
        try:
            existing = json.loads(OUTPUT.read_text())
            results = existing
            already_scraped = {v["url"] for v in existing}
            print(f"  → Reprise : {len(already_scraped)} véhicules déjà scrapés")
        except Exception:
            pass

    total = len(vehicles_meta)
    todo = [m for m in vehicles_meta if m["url"] not in already_scraped]
    print(f"  → {len(todo)} véhicules restants à scraper")

    # Init session : visite la page principale pour obtenir le cookie
    print("  → Init session (cookie PHPSESSID)...")
    try:
        SESSION.get(BASE_URL, timeout=15)
        time.sleep(2)
    except Exception:
        pass

    for i, meta in enumerate(todo, 1):
        print(f"[{len(already_scraped)+i}/{total}] {meta['brand']} {meta['model']}...")
        data = scrape_vehicle(meta["url"], meta["brand"], meta["model"])
        if data:
            results.append(data)
            print(f"    ✓ battery={data.get('battery_kwh')} kWh  "
                  f"conso={data.get('consumption_wh_per_km')} Wh/km")
            # Sauvegarde intermédiaire tous les 10 véhicules
            if i % 10 == 0:
                OUTPUT.parent.mkdir(parents=True, exist_ok=True)
                OUTPUT.write_text(json.dumps(results, ensure_ascii=False, indent=2))
        time.sleep(DELAY)

    # Tri alphabétique brand + model + sauvegarde finale
    results.sort(key=lambda v: (v["brand"].lower(), v["model"].lower()))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(results, ensure_ascii=False, indent=2))
    print(f"\n✓ {len(results)} véhicules exportés → {OUTPUT}")


if __name__ == "__main__":
    main()
