"""
Client HTTP async pour les horloges Awtrix NG (firmware awtrix-ng ≥ 1.1.x).

Envoie trois types de notifications lors des sessions de charge :
  - Début de charge  : notification éphémère (couleur verte, réveil écran)
  - Mise à jour      : app persistante "evstats" (énergie + durée, toutes les N min)
  - Fin de charge    : supprime l'app + notification (orange)

Chaque horloge enregistrée (table AwtrixClock) choisit lesquelles elle reçoit.
Les envois sont diffusés en parallèle ; une horloge injoignable n'empêche pas
les autres d'être servies, et toutes les erreurs réseau sont journalisées sans
remonter — une notification ratée ne doit jamais interrompre le suivi de charge.

────────────────────────────────────────────────────────────────────────────────
Portage AWTRIX 3 → AWTRIX NG (v1.9.0)
────────────────────────────────────────────────────────────────────────────────
L'API d'AWTRIX 3 n'existe plus : ses routes répondent 404 et ses clés de payload
sont refusées nommément (422 `unknown key`). Correspondances appliquées ici :

    POST /api/notify            → POST   /api/v1/notifications
    POST /api/custom?name=X     → PUT    /api/v1/apps/pushed/X
    POST /api/custom?name=X {}  → DELETE /api/v1/apps/X
    color                       → textColor
    duration   (secondes)       → durationMs  (millisecondes)
    lifetime   (secondes)       → lifetimeMs  (millisecondes)

`wakeup` reste valide mais uniquement sur la route des notifications ; l'envoyer
à une app pousse un 422. `Content-Type: application/json` est obligatoire (httpx
le pose via `json=`), et un corps vide ne supprime plus rien.

Référence : relevés sur Ulanzi TC001 / NG 1.1.2 dans le projet awtrixng-mgr
(`docs/ng-api/payload-keys.md` et `docs/ng-vs-awtrix3.md`).
"""

import asyncio

import httpx
from sqlmodel import Session, select

from .database import engine
from .models import AlertConfig, AwtrixClock

# Nom de l'app persistante poussée pendant la charge.
# NG supprime au nom exact (plus par préfixe comme AWTRIX 3), donc un nom
# simple suffit — plus besoin de largeur fixe.
APP_NAME = "evstats"

# Icônes LaMetric, installées à la demande sur chaque horloge (voir _ensure_icon).
# Un reflash vide /ICONS : sans réinstallation, le texte s'affiche sans icône.
ICON_START = "44432"   # prise électrique animée
ICON_UPDATE = "53214"  # batterie en charge (~60%)
ICON_END = "53216"     # batterie pleine (~100%)

LAMETRIC_ICON_URL = "https://developer.lametric.com/content/apps/icon_thumbs/{icon_id}"

TIMEOUT = 5.0

#: Icônes déjà constatées présentes, par URL d'horloge. Évite un GET /files à
#: chaque notification. Vidé au redémarrage du container, ce qui suffit.
_icon_cache: dict[str, set[str]] = {}


def _fmt_duration(duration_min: float) -> str:
    h = int(duration_min // 60)
    m = int(duration_min % 60)
    return f"{h}h{m:02d}" if h > 0 else f"{m}min"


def _api(base_url: str, path: str) -> str:
    return f"{base_url.rstrip('/')}/api/v1{path}"


# ── Sélection des destinataires ──────────────────────────────────────────────

def _clocks(kind: str) -> list[AwtrixClock]:
    """
    Horloges activées ayant opté pour ce type de notification.

    kind ∈ {"start", "update", "end"} → colonne notify_<kind>.
    """
    column = {"start": AwtrixClock.notify_start,
              "update": AwtrixClock.notify_update,
              "end": AwtrixClock.notify_end}[kind]
    with Session(engine) as db:
        return list(db.exec(
            select(AwtrixClock).where(
                AwtrixClock.enabled == True,  # noqa: E712 — SQLModel veut l'opérateur
                column == True,               # noqa: E712
                AwtrixClock.url != "",
            )
        ).all())


def _update_interval_min() -> int:
    with Session(engine) as db:
        config = db.get(AlertConfig, 1)
    return config.awtrix_update_interval_min if config else 30


# ── Transport ────────────────────────────────────────────────────────────────

async def _ensure_icon(client: httpx.AsyncClient, base_url: str, icon_id: str) -> bool:
    """
    Installe l'icône sur l'horloge si elle n'y est pas déjà.

    Retourne True si l'icône est disponible ensuite. Un échec n'est jamais
    bloquant : le texte sans icône vaut mieux qu'une notification perdue, donc
    l'appelant traite le résultat comme indicatif.

    Les icônes LaMetric animées sortent en GIF, directement exploitables. Les
    icônes fixes arrivent en PNG, que le firmware stocke sans jamais les
    dessiner — leur conversion demanderait Pillow, dépendance qu'evstats n'a
    pas et que ses trois icônes ne justifient pas (toutes animées). Un non-GIF
    est donc signalé et ignoré.
    """
    known = _icon_cache.get(base_url)
    if known is None:
        try:
            r = await client.get(_api(base_url, "/files"), params={"dir": "/ICONS"})
            r.raise_for_status()
            known = {f["name"].rsplit(".", 1)[0] for f in r.json().get("files", [])}
        except Exception as e:
            print(f"[awtrix] {base_url} : liste des icones illisible ({e})", flush=True)
            return False
        _icon_cache[base_url] = known

    if icon_id in known:
        return True

    try:
        src = await client.get(LAMETRIC_ICON_URL.format(icon_id=icon_id))
        src.raise_for_status()
        if not src.headers.get("content-type", "").startswith("image/gif"):
            print(f"[awtrix] icone {icon_id} non animee (PNG) — ignoree", flush=True)
            return False
        await client.post(
            _api(base_url, "/files"),
            params={"dir": "/ICONS"},
            files={"file": (f"{icon_id}.gif", src.content, "image/gif")},
        )
        known.add(icon_id)
        print(f"[awtrix] icone {icon_id} installee sur {base_url}", flush=True)
        return True
    except Exception as e:
        print(f"[awtrix] icone {icon_id} non installee sur {base_url} : {e}", flush=True)
        return False


async def _send(clock: AwtrixClock, kind: str, payload: dict, icon_id: str | None) -> None:
    """
    Envoie une notification ou pousse l'app persistante sur une horloge.

    kind ∈ {"notify", "app"}. Toute erreur est journalisée et absorbée.
    """
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            if icon_id and await _ensure_icon(client, clock.url, icon_id):
                payload = {**payload, "icon": icon_id}
            if kind == "notify":
                r = await client.post(_api(clock.url, "/notifications"), json=payload)
            else:
                r = await client.put(_api(clock.url, f"/apps/pushed/{APP_NAME}"), json=payload)
            if r.status_code >= 400:
                print(f"[awtrix] {clock.name or clock.url} : HTTP {r.status_code} {r.text[:200]}", flush=True)
    except Exception as e:
        print(f"[awtrix] {clock.name or clock.url} injoignable : {e}", flush=True)


async def _delete_app(clock: AwtrixClock) -> None:
    """Retire l'app persistante. NG supprime au nom exact, et DELETE a remplacé
    le POST d'un corps vide d'AWTRIX 3."""
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            await client.delete(_api(clock.url, f"/apps/{APP_NAME}"))
    except Exception as e:
        print(f"[awtrix] {clock.name or clock.url} : suppression app echouee ({e})", flush=True)


async def _fanout(clocks: list[AwtrixClock], coro_factory) -> None:
    """Diffuse en parallèle ; une horloge en échec n'affecte pas les autres."""
    if clocks:
        await asyncio.gather(*(coro_factory(c) for c in clocks), return_exceptions=True)


# ── Notifications de session ─────────────────────────────────────────────────

async def notify_charge_start(charger_name: str, power_w: float) -> None:
    clocks = _clocks("start")
    if not clocks:
        return
    kw = power_w / 1000
    payload = {
        "text": f"Charge {charger_name} {kw:.1f}kW",
        "textColor": "#00FF00",
        "durationMs": 10_000,
        "wakeup": True,
    }
    await _fanout(clocks, lambda c: _send(c, "notify", payload, ICON_START))
    print(f"[awtrix] Debut charge : {charger_name} {kw:.1f} kW -> {len(clocks)} horloge(s)", flush=True)


async def notify_charge_update(charger_name: str, energy_kwh: float, duration_min: float) -> None:
    clocks = _clocks("update")
    if not clocks:
        return
    # lifetime = intervalle + marge de 5 min, pour auto-expirer si le poller s'arrête
    lifetime_ms = (_update_interval_min() * 60 + 300) * 1000
    payload = {
        "text": f"{energy_kwh:.1f}kWh {_fmt_duration(duration_min)}",
        "textColor": "#00BFFF",
        "lifetimeMs": lifetime_ms,
    }
    await _fanout(clocks, lambda c: _send(c, "app", payload, ICON_UPDATE))
    print(f"[awtrix] Update : {energy_kwh:.2f} kWh / {_fmt_duration(duration_min)} -> {len(clocks)} horloge(s)", flush=True)


async def notify_charge_end(charger_name: str, energy_kwh: float, cost_eur: float, duration_min: float) -> None:
    # L'app persistante est retirée partout où elle a pu être poussée, y compris
    # sur une horloge qui ne veut pas la notification de fin : sinon elle y
    # resterait jusqu'à expiration du lifetime.
    await _fanout(_clocks("update"), _delete_app)

    clocks = _clocks("end")
    if not clocks:
        return
    payload = {
        "text": f"Fin charge {energy_kwh:.1f}kWh {cost_eur:.2f}EUR {_fmt_duration(duration_min)}",
        "textColor": "#FF8C00",
        "durationMs": 30_000,
        "wakeup": True,
    }
    await _fanout(clocks, lambda c: _send(c, "notify", payload, ICON_END))
    print(f"[awtrix] Fin charge : {energy_kwh:.2f} kWh / {cost_eur:.2f} EUR -> {len(clocks)} horloge(s)", flush=True)


# ── Test de connexion ────────────────────────────────────────────────────────

async def send_test(url: str) -> tuple[bool, str]:
    """
    Envoie une notification de test à l'URL fournie (pas besoin d'avoir sauvegardé).

    Retourne (succès, détail). Le détail porte la version du firmware en cas de
    succès, le motif de l'échec sinon — ce qui distingue une horloge éteinte
    d'une horloge restée en AWTRIX 3, le symptôme étant le même côté UI.
    """
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            try:
                v = await client.get(_api(url, "/version"))
                version = v.json().get("version", "?") if v.status_code == 200 else None
            except Exception:
                version = None
            if version is None:
                return False, ("Pas de reponse sur /api/v1/version — horloge injoignable, "
                               "ou encore en firmware AWTRIX 3 (API incompatible)")

            payload = {
                "text": "EVSE Stats OK",
                "textColor": "#00FF00",
                "durationMs": 5_000,
                "wakeup": True,
            }
            if await _ensure_icon(client, url, ICON_START):
                payload["icon"] = ICON_START
            r = await client.post(_api(url, "/notifications"), json=payload)
            if r.status_code >= 400:
                return False, f"HTTP {r.status_code} : {r.text[:200]}"
            return True, f"Firmware AWTRIX NG {version}"
    except Exception as e:
        return False, str(e)
