# EVSE Stats WebUI (Morec / EVSEMaster)

> 🇬🇧 **English summary below** — [Jump to English section](#english)

Interface web de visualisation et d'analyse des sessions de charge issues de l'application **EVSEMaster**, via import de fichiers Excel (.xlsx).

En l'absence d'API fournie par la borne Morec ou l'application EVSEMaster, cette solution repose sur des exports manuels réguliers.

---

<a name="english"></a>
## 🇬🇧 English

**EVSE Stats** is a self-hosted web dashboard for visualising EV charging sessions exported from the **EVSEMaster** app (used with Morec EV wallboxes).

Since Morec / EVSEMaster provides no API, the workflow relies on manual `.xlsx` exports from the mobile app.

> ⚠️ The HC/HP tariff split is specific to **French EDF contracts** (off-peak / peak hours). The rules are: Wednesday & weekends = 100% HC, weekdays HC window = 23:30→07:30. You can adapt `backend/app/tariff.py` for other tariff structures.

### Features
- Import `.xlsx` exports with automatic deduplication
- HC/HP cost calculation (minute-by-minute session splitting)
- Dashboard: KPIs, charts, monthly ranking, yearly summary
- Tariff history with validity periods (recalculate at any time)
- Consumption alerts via webhook (ntfy, Slack, Discord…)
- Monthly PDF reports
- Vehicle page: specs, photo, cost per 100 km
- Hourly frequency chart
- CSV export, SQLite backup script

### Quick start

```bash
git clone https://github.com/picardflo/evstats.git
cd evstats
docker compose up -d --build
```

App available at **http://localhost:8080**

Then go to **Paramètres** (Settings) to configure your tariff rates before importing data.

### Reverse proxy (optional)

To expose behind Caddy or Nginx, disable the port mapping via `docker-compose.override.yml`:

```yaml
# docker-compose.override.yml
services:
  evstats-frontend:
    ports: []
```

See `docker-compose.override.yml.example` for a full homelab example.

### Stack
| Layer | Technology |
|---|---|
| Backend | Python 3.12 · FastAPI · SQLModel · SQLite |
| Frontend | React 18 · Vite · Material UI (dark) · Recharts |
| Container | Docker + Docker Compose |

### License
MIT — see [LICENSE](LICENSE)

---

## Fonctionnalités

### Import des données
- Import manuel de fichiers `.xlsx` (drag & drop ou sélection)
- Déduplication automatique des sessions (basée sur `Numéro d'enregistrement`)
- Historique des imports (date, fichier, nouvelles sessions, doublons)

### Calcul tarifaire
- Répartition HC / HP au niveau de la minute pour chaque session
- Gestion des sessions chevauchant plusieurs plages tarifaires (ex : mardi 23h → mercredi 08h)
- Tarifs EDF éditables via l'interface (sans redéploiement)
- Recalcul des coûts sur toutes les sessions existantes en un clic

### Dashboard
- **KPIs** : sessions, énergie, HC, HP, coût total, coût moyen/session, coût effectif c€/kWh, économies réalisées vs 100% HP
- **Tendances** mois N vs mois N-1 (↑↓ avec %)
- **Graphiques** : consommation HC/HP empilée, coût réel + économies, durée de charge
- **Camembert** répartition HC/HP
- **Vues** : 30 jours, journalière, mensuelle
- **Classement des mois** avec % HC, coût moyen/session, économies

### Sessions
- Tableau paginé avec filtres (statut de fin, plage de dates)
- Export CSV des sessions filtrées

### Paramètres
- Édition des tarifs HC et HP (en c€/kWh)
- Recalcul des coûts sur l'historique complet
- Affichage des règles tarifaires en vigueur

---

## Contrat EDF

**Option tarifaire** : Heures Creuses + Week-end + Mercredi — 12 kVA

### Tarifs (au 16/03/2026)

| Type | Prix (c€/kWh) |
|---|---|
| HC semaine | 17,24 |
| HP semaine | 23,05 |
| HC week-end | 17,24 |
| HP week-end | 17,24 |
| HC mercredi | 17,24 |
| HP mercredi | 17,24 |

### Règles de classification HC/HP

| Période | Règle |
|---|---|
| Mercredi | 100% Heures Creuses |
| Samedi & Dimanche | 100% Heures Creuses |
| Lun / Mar / Jeu / Ven | HC : 23h30 → 07h30 · HP : 07h30 → 23h30 |

> Les tarifs changent typiquement deux fois par an (février et août). Ils sont modifiables directement dans l'interface via **Paramètres → Tarifs EDF**, sans redéploiement.

---

## Architecture technique

```
evstats/
├── backend/                   # API Python FastAPI
│   ├── app/
│   │   ├── main.py            # Endpoints FastAPI
│   │   ├── models.py          # Modèles SQLModel (ChargingSession, ImportLog, TariffConfig)
│   │   ├── database.py        # Connexion SQLite
│   │   ├── parser.py          # Parsing XLSX → ParsedSession
│   │   └── tariff.py          # Calcul HC/HP (découpage minute-à-minute)
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/                  # UI React + Vite
│   ├── src/
│   │   ├── api/client.js      # Appels axios vers /api
│   │   ├── components/
│   │   │   └── Layout.jsx     # Sidebar + navigation
│   │   └── pages/
│   │       ├── Dashboard.jsx  # Graphiques + KPIs
│   │       ├── Import.jsx     # Drag & drop xlsx
│   │       ├── Sessions.jsx   # Tableau filtrable + export CSV
│   │       └── Settings.jsx   # Configuration des tarifs
│   ├── package.json
│   ├── vite.config.js
│   ├── nginx.conf
│   └── Dockerfile
├── caddy/
│   └── Caddyfile              # Bloc à ajouter au Caddy existant
├── scripts/
│   └── backup.sh              # Backup quotidien SQLite (cron)
├── docker-compose.yml
├── VERSION                    # Version unique de l'application (ex: 1.2.0)
└── .gitignore
```

### Stack

| Couche | Technologie |
|---|---|
| Backend | Python 3.12 · FastAPI · SQLModel · pandas · openpyxl |
| Base de données | SQLite |
| Frontend | React 18 · Vite · Material UI (dark theme) · Recharts |
| Reverse proxy | Caddy (existant sur la VM) |
| Conteneurs | Docker + Docker Compose |

---

## Gestion des versions

La version de l'application est définie dans un **unique fichier `VERSION`** à la racine du repo. C'est la seule source de vérité — backend et frontend lisent la même valeur.

```
evstats/
└── VERSION        # ex: 1.2.0
```

- Le **backend** lit ce fichier depuis le filesystem (monté en read-only via `docker-compose.yml`) et l'expose via `GET /api/version`.
- Le **frontend** interroge cet endpoint au démarrage et affiche la version dans le footer de la sidebar (`EVSE Stats v1.2.0`).

Aucune duplication de version dans `package.json`, `pyproject.toml` ou ailleurs.

### Incrémenter la version

```bash
# 1. Mettre à jour le fichier
echo "1.3.0" > VERSION

# 2. Committer et pousser
git add VERSION && git commit -m "chore: bump version 1.3.0"
git push

# 3. Déployer sur la VM
git pull && docker compose up -d --build
```

Le frontend affiche automatiquement la nouvelle version après le redéploiement, sans aucun autre changement.

---

## Modèle de données

### `charging_sessions`

| Champ | Type | Description |
|---|---|---|
| id | INTEGER PK | Identifiant interne |
| record_id | TEXT UNIQUE | Numéro d'enregistrement EVSEMaster (clé de déduplication) |
| charger_id | TEXT | Numéro de chargeur |
| start_time | DATETIME | Début de session |
| end_time | DATETIME | Fin de session |
| duration_minutes | FLOAT | Durée (fournie par EVSEMaster) |
| energy_kwh | FLOAT | Énergie consommée |
| hc_kwh | FLOAT | Part HC (calculée) |
| hp_kwh | FLOAT | Part HP (calculée) |
| cost_eur | FLOAT | Coût calculé (hc_kwh × prix_HC + hp_kwh × prix_HP) |
| end_status | TEXT | Motif de fin : Pull Plug, Fix Time, Power Down, ou hash RFID |
| start_user | TEXT | Initiateur : Clock ou hash RFID |

### `import_log`

Historique des imports : fichier, date, nombre de nouvelles sessions et doublons.

### `tariff_config`

Un seul enregistrement (id=1) contenant les prix HC et HP actifs, mis à jour via l'interface.

---

## API REST

| Méthode | Endpoint | Description |
|---|---|---|
| POST | `/api/import` | Import d'un fichier .xlsx |
| GET | `/api/sessions` | Liste paginée + filtres (end_status, start_date, end_date) |
| GET | `/api/sessions/export` | Export CSV (mêmes filtres) |
| GET | `/api/stats/daily` | Agrégats journaliers |
| GET | `/api/stats/monthly` | Agrégats mensuels |
| GET | `/api/imports` | Historique des imports |
| GET | `/api/config/tariff` | Tarifs actuels |
| PUT | `/api/config/tariff` | Mise à jour des tarifs |
| POST | `/api/config/tariff/recalculate` | Recalcul des coûts sur tout l'historique |
| GET | `/api/health` | Health check |

---

## Déploiement

### Prérequis VM

- Docker + Docker Compose
- Caddy existant connecté au réseau Docker `home.lan`
- Accès internet depuis Docker (pour le build npm)

### Installation

```bash
# 1. Créer le dossier de données
mkdir -p /srv/docker_data/evstats

# 2. Cloner le repo
cd /srv/docker_data
git clone git@gogs.home.lan:fpicard/evstats.git

# 3. Build et démarrage
cd evstats
docker compose up -d --build
```

### Ajouter le bloc dans le Caddyfile existant

```caddy
evstats.home.lan {
    reverse_proxy evstats-frontend:80
}
```

```bash
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
```

### Mise à jour

```bash
cd /srv/docker_data/evstats
git pull
docker compose up -d --build
```

### Backup SQLite (cron)

```bash
# Ajouter dans crontab (crontab -e)
0 3 * * * /srv/docker_data/evstats/scripts/backup.sh
```

Le script conserve 30 jours de backups dans `/srv/docker_data/evstats/backups/`.

---

## Roadmap

### v1.0.0 — MVP
- [x] Import XLSX avec déduplication (`record_id`)
- [x] Parsing EVSEMaster (colonnes FR)
- [x] Stockage SQLite
- [x] Calcul HC/HP avec découpage minute-à-minute des sessions
- [x] Dashboard : KPIs, graphiques barres HC/HP, camembert, classement des mois
- [x] Tarifs EDF configurables via UI + recalcul global
- [x] Économies vs facturation 100% HP
- [x] Tendances vs mois précédent
- [x] Vue 30 jours / journalière / mensuelle
- [x] Tableau sessions paginé + filtrable (statut, dates)
- [x] Export CSV (filtres actifs)
- [x] Script backup SQLite (30 jours de rétention)
- [x] Déploiement Docker + Caddy

### v1.1.0
- [x] Historique des tarifs EDF avec périodes de validité (`valid_from`)
- [x] Recalcul des coûts par tranche historique (bon tarif par date de session)
- [x] Graphique fréquence horaire des sessions (coloration HC/HP)
- [x] Alertes consommation mensuelle (seuil kWh / €, webhook ntfy/Slack/Discord)
- [x] Export rapport PDF mensuel (KPIs + tableau des sessions)
- [x] Footer version dynamique (fichier `VERSION` unique, backend + frontend)

### v1.2.0
- [x] Correction responsive : tableaux scrollables, PieChart adaptatif, formulaires mobile
- [x] Légende explicative sur le graphique "Coût réel vs économies"
- [x] PieChart dans `ResponsiveContainer` (adaptatif)

### v1.2.1
- [x] Récapitulatif annuel (énergie, coût, économies par année)
- [x] Filtre par année sur le classement des mois

### v1.3.0
- [x] Page Véhicule : specs (batterie nette, conso réelle), photo upload
- [x] KPIs au kilomètre : km rechargés, coût/100km, économies/100km, pleins équivalents
- [x] Upload image véhicule (JPEG/PNG/WebP, stockée dans le volume Docker)
- [x] Publication open source (GitHub, licence MIT, GitHub Actions GHCR)

### À venir
- [ ] Support multi-chargeurs
- [ ] Comparaison coût électrique vs thermique (€/100km)
- [ ] Import automatique via partage de fichier (Nextcloud, etc.)

---

## Contraintes connues

- Pas d'API côté borne Morec ni EVSEMaster → dépendance aux exports manuels `.xlsx`
- Format de colonnes potentiellement variable selon la version EVSEMaster
- Règles HC/HP spécifiques au contrat **EDF France** (adaptable dans `backend/app/tariff.py`)

---

## Auteur

Florian PICARD — [GitHub](https://github.com/picardflo)
