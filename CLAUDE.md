# CLAUDE.md — evstats

Contexte du projet pour les sessions Claude Code.

## Présentation

**evstats** — Application de suivi des sessions de charge pour borne EVSE domestique.
Stack : FastAPI (backend Python) + React + Vite (frontend) + Caddy (reverse proxy), le tout orchestré par Docker Compose.

Version courante : voir `VERSION` (actuellement 1.9.0).

## Déploiement

- **VM homelab** : l'app tourne sur une VM Linux dans le homelab de Florian
- **URL locale** : `http://evstats.home.lan` (Caddy reverse proxy)
- **Docker Compose** : deux services principaux
  - `evstats-api` — FastAPI, `network_mode: host` (obligatoire pour recevoir les broadcasts UDP LAN)
  - `evstats-frontend` — nginx sur port 8080
- **Volume Docker** : `evstats_data` monté sur `/app/data` (contient la DB SQLite + `active_charges.json`)

### Commandes de déploiement habituelles (à lancer sur la VM)

```bash
# Rebuild et restart d'un service
docker compose up -d --build evstats-api
docker compose up -d --build evstats-frontend

# Restart sans rebuild (ex. après changement de config)
docker compose restart evstats-api

# Voir les logs en live
docker logs -f evstats-api

# Lancer un script Python sans polluer la VM (pas de pip global)
docker run --rm -v $(pwd):/app -w /app python:3.12-slim python scripts/mon_script.py
```

## Git — deux remotes

```
origin  → ssh://git@gogs.home.lan:2222/fpicard/evstats.git   (Gogs privé)
github  → git@github.com:picardflo/evstats.git               (GitHub public)
```

**Toujours pousser sur les deux** après chaque commit :

```bash
git push && git push github
```

## Architecture du code

```
backend/app/
  main.py            — FastAPI app, lifespan, endpoints API
  charger_poller.py  — Boucle asyncio de polling UDP, détection début/fin de session
  udp_client.py      — Protocole UDP EVSEMaster (Morec MC20CAPP)
  models.py          — SQLModel : Charger, ChargingSession, TariffPeriod…
  database.py        — Engine SQLite
  tariff.py          — Calcul des tarifs HC/HP
  parser.py          — Import XLSX (historique)
  report.py          — Export/rapports
  awtrix_notifier.py — Notifications horloges Awtrix NG (multi-horloge)

frontend/src/
  pages/             — Dashboard, Sessions, Chargers, Vehicle, Import, Settings, Alerts
  components/        — Composants réutilisables
  hooks/             — Hooks React

frontend/public/
  vehicles_db.json   — Base de données véhicules (29 modèles, données WLTP)

scripts/
  scrape_ev_database.py  — Scraper ev-database.org (whitelist par marque/modèle)
  backup.sh
```

## Protocole UDP — Borne Morec MC20CAPP

- Broadcast de la borne toutes les ~5s sur port **28376**
- Flow : Broadcast → RequestLogin (0x8002) → LoginOK (0x0002) → LoginConfirm (0x8001) → GetStatus (0x8004) → StatusResponse (0x0004)
- Une seule session UDP à la fois (l'app EVSEMaster doit être fermée)
- `network_mode: host` sur le container API est **obligatoire** pour recevoir les broadcasts

### Payload StatusResponse (0x0004) — offsets validés sur Morec MC20CAPP

| Offset | Type          | Facteur | Champ                       |
|--------|---------------|---------|-----------------------------|
| [0]    | uint8         | —       | Statut (0x01=en charge)     |
| [1:3]  | uint16 BE     | ×0.1    | Tension (V)                 |
| [3:5]  | uint16 BE     | ×0.01   | Courant (A)                 |
| [7:9]  | uint16 BE     | ×1      | Puissance (W)               |
| **[9:13]** | **uint32 BE** | **×10 Wh** | **Compteur énergie absolu** |

> Attention : le champ [15:17] (uint16) fluctue indépendamment de l'énergie réelle — ne pas utiliser.

## Horloges Awtrix NG

- Firmware **AWTRIX NG** requis (testé en 1.1.2). L'API d'AWTRIX 3 n'existe plus :
  ses routes répondent 404 et ses clés de payload sont refusées en 422.
- Horloges du homelab : `awtrix-cl1.home.lan` (Salon) et `awtrix-cl2.home.lan` (Bureau).
  **cl2 est l'horloge de test** ; cl1 est en service et protégée côté awtrixng-mgr.
- Plusieurs horloges enregistrables (table `AwtrixClock`), chacune choisissant
  les notifications qu'elle reçoit. Intervalle de suivi commun à toutes.

### Portage AWTRIX 3 → NG

| AWTRIX 3 | AWTRIX NG |
|---|---|
| `POST /api/notify` | `POST /api/v1/notifications` |
| `POST /api/custom?name=X` | `PUT /api/v1/apps/pushed/X` |
| `POST /api/custom?name=X` + corps vide | `DELETE /api/v1/apps/X` |
| `color` | `textColor` |
| `duration` (s) | `durationMs` (ms) |
| `lifetime` (s) | `lifetimeMs` (ms) |

> `wakeup` reste valide mais **uniquement** sur la route des notifications.
> Un reflash vide `/ICONS` : les icônes sont réinstallées automatiquement
> depuis LaMetric lors du premier envoi.

> Référence complète mesurée sur matériel réel : repo **awtrixng-mgr**,
> `docs/ng-api/payload-keys.md` et `docs/ng-vs-awtrix3.md`.

### Cohabitation avec awtrixng-mgr

Aucun risque de collision : awtrixng-mgr ne gère que les apps nommées `ng` +
6 chiffres (`is_managed`), evstats pousse `evstats`. NG supprime au **nom exact**
(plus par préfixe comme AWTRIX 3), donc chacun ne touche que les siennes.

## Logique de suivi de session (charger_poller.py)

- **Début** : 2 lectures consécutives > 0.5A → session confirmée (`CHARGE_START_CONFIRMS = 2`)
- **Fin** : 3 lectures consécutives < 0.1A → session enregistrée (`CHARGE_END_CONFIRMS = 3`)
- **Énergie** : delta du compteur hardware entre deux polls (uint32 × 10 Wh)
  - Si delta < 0 : ignoré (paquet périmé/bruit)
  - Si delta > puissance_max × Δt × 2 : saut aberrant ignoré (ex. restart avec changement d'unité)
- **Seuil minimum** : sessions < 0.1 kWh ignorées (filtrage des cycles DC-DC 12V post-charge)
- **Persistance** : `active_charges.json` survit aux restarts du container

## Données véhicules

- Fichier : `frontend/public/vehicles_db.json`
- Source : [ev-database.org](https://ev-database.org) (scraper `scripts/scrape_ev_database.py`)
- 6 valeurs WLTP par véhicule : été/hiver × ville/autoroute/mixte (Wh/km)
- `consumption_wh_per_km` = WLTP été mixte (valeur de référence principale)

## Règles de workflow

1. **README.md** — toujours mettre à jour la section roadmap avec le numéro de version et la description du changement
2. **VERSION** — bumper avant chaque commit de feature/fix
3. **Tag** — après le dernier commit d'une version, poser un tag annoté sur ce commit :
   `git tag -a vX.Y.Z -m "vX.Y.Z" && git push --tags && git push github --tags`
   Convention : le tag pointe sur le **dernier** commit portant ce numéro dans `VERSION`,
   pas sur le commit de bump — ainsi `git describe` décrit tout commit et le tag correspond
   à l'état réellement déployé. L'historique est tagué de v1.0.0 à v1.9.0.
4. **Push** — toujours `git push && git push github`
5. **Tests UI** — impossible depuis cet environnement de dev ; déployer sur la VM et vérifier en navigateur
6. **Dépendances Python** — `requirements.txt` épingle aussi `pydantic` : `sqlmodel==0.0.21`
   ne démarre plus avec pydantic ≥ 2.12. Avant de relâcher une borne, vérifier qu'un
   `pip install -r requirements.txt` neuf produit encore un container qui démarre.
7. **Dépendances frontend** — le build utilise `npm ci` et `frontend/package-lock.json`
   est committé. Toute modification de `package.json` impose de régénérer le lockfile
   (`npm install` en local) et de le committer, sinon le build casse sur la VM.
8. **Pas de pip global sur la VM** — utiliser `docker run --rm -v $(pwd):/app -w /app python:3.12-slim`
