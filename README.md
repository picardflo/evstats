# EVSE Stats WebUI (Morec / EVSEMaster)

> 🇬🇧 **English summary below** — [Jump to English section](#english)

Interface web de visualisation et d'analyse des sessions de charge pour bornes **Morec / EVSEMaster**.

Deux modes d'acquisition des données :
- **UDP direct** (v1.5+) : connexion temps réel à la borne, enregistrement automatique des sessions
- **Import XLSX** : import manuel des exports EVSEMaster (compatible avec l'historique existant)

---

<a name="english"></a>
## 🇬🇧 English

**EVSE Stats** is a self-hosted web dashboard for visualising EV charging sessions from **Morec / EVSEMaster** wallboxes.

Two data acquisition modes are supported:
- **Direct UDP** (v1.5+): real-time connection to the charger via the EVSEMaster UDP protocol (port 28376), automatic session recording — no manual export needed.
- **XLSX import**: manual import of EVSEMaster `.xlsx` exports — compatible with existing history.

> The HC/HP tariff split targets **French EDF contracts**. Rules are fully configurable from the Settings page (full-HC days, time windows). The **Tempo** tariff (3-tier: Blue/White/Red days published daily by RTE) is not yet supported as it requires a live external API.

### Features
- Direct UDP integration — real-time voltage, current, power, automatic session recording
- Live charge banner: energy consumed (kWh) + elapsed duration updated every 5 s
- Import `.xlsx` exports with automatic deduplication
- HC/HP cost calculation (minute-by-minute session splitting)
- **Configurable HC/HP rules**: full-HC days, multiple time windows — adapts to any French EDF contract
- Dashboard: KPIs, charts, monthly ranking, yearly summary
- Tariff history with validity periods (recalculate at any time)
- Consumption alerts via webhook (ntfy, Slack, Discord…)
- Monthly PDF reports
- Vehicle page: specs, photo, cost per 100 km
- Hourly frequency chart
- CSV export, SQLite backup script

### Screenshots

**Dashboard — KPIs, graphiques HC/HP, coût réel vs économies**
![Dashboard](https://github.com/user-attachments/assets/7c4b488c-0cb1-404c-8663-716860473eb4)

**Import XLSX — drag & drop, historique des imports**
![Import](https://github.com/user-attachments/assets/f6bdceac-a073-4d81-b336-f4bfe2f56654)

**Sessions de charge — tableau paginé + filtres**
![Sessions](https://github.com/user-attachments/assets/44c1a770-6fe3-4de6-9c6e-3d5bcb6234ef)

**Véhicule — specs, photo, KPIs au kilomètre**
![Véhicule](https://github.com/user-attachments/assets/e1a417f5-016b-4f38-8e9c-d0efc545a4d3)

**Paramètres — historique des tarifs EDF**
![Paramètres](https://github.com/user-attachments/assets/ca3ce7c7-4d8e-49dd-ac01-61805cf05b9c)

---

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

### Intégration UDP directe (v1.5+)

- Page **Chargeurs** : ajout/modification/suppression de bornes via l'interface
- Support IP ou FQDN (résolution DNS locale)
- Test de connexion avec découverte automatique du numéro de série
- Upload photo de la borne
- Statut temps réel : tension (V), courant (A), puissance (kW) via bouton Rafraîchir
- **Polling automatique** toutes les 30 s en veille, continu pendant la charge
- **Détection automatique** début/fin de session (seuil > 0.5 A, 3 lectures consécutives à 0 pour confirmer)
- **Enregistrement automatique** des sessions terminées en base (calcul HC/HP + coût)
- **Bannière "Charge en cours"** sur le Dashboard : tension · courant · puissance · énergie · durée (rafraîchi toutes les 5 s)
- **Persistance restart-proof** : l'état de la session active (start_time + énergie) survit aux redémarrages du backend

### Import des données

- Import manuel de fichiers `.xlsx` (drag & drop ou sélection)
- Déduplication automatique des sessions (basée sur `Numéro d'enregistrement`)
- Historique des imports (date, fichier, nouvelles sessions, doublons)

### Calcul tarifaire

- Répartition HC / HP au niveau de la minute pour chaque session
- Gestion des sessions chevauchant plusieurs plages tarifaires
- Tarifs EDF éditables via l'interface (sans redéploiement)
- Historique des périodes tarifaires avec `valid_from` (bon tarif selon la date de la session)
- Recalcul des coûts sur toutes les sessions existantes en un clic

### Dashboard

- **KPIs** : sessions, énergie, HC, HP, coût total, coût moyen/session, coût effectif c€/kWh, économies réalisées vs 100% HP
- **Tendances** mois N vs mois N-1 (↑↓ avec %)
- **Graphiques** : consommation HC/HP empilée, coût réel + économies, durée de charge, fréquence horaire
- **Camembert** répartition HC/HP
- **Vues** : 30 jours, journalière, mensuelle
- **Classement des mois** avec % HC, coût moyen/session, économies
- **Récapitulatif annuel**

### Sessions

- Tableau paginé avec filtres (statut de fin, plage de dates)
- Chip visuel sur les sessions enregistrées automatiquement via UDP
- Export CSV des sessions filtrées

### Paramètres

- Édition des tarifs HC et HP (en c€/kWh)
- Règles HC/HP configurables : jours entièrement HC, plages horaires (plusieurs fenêtres possibles)
- Recalcul HC/HP + coûts sur l'historique complet en un clic
- Alertes consommation mensuelle (seuil kWh / €, webhook ntfy/Slack/Discord)

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
├── backend/
│   ├── app/
│   │   ├── main.py              # Endpoints FastAPI + lifespan (démarrage poller)
│   │   ├── models.py            # Modèles SQLModel (ChargingSession, Charger, ...)
│   │   ├── database.py          # Connexion SQLite
│   │   ├── parser.py            # Parsing XLSX → ParsedSession
│   │   ├── tariff.py            # Calcul HC/HP (découpage minute-à-minute)
│   │   ├── udp_client.py        # Protocole UDP EVSEMaster (port 28376)
│   │   └── charger_poller.py    # Poller asyncio : cache statut + détection sessions
│   ├── migrate_utc_to_paris.py  # Migration one-shot : correction timezone UTC→Paris
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── api/client.js        # Appels axios vers /api
│   │   ├── components/
│   │   │   └── Layout.jsx       # Sidebar + navigation
│   │   └── pages/
│   │       ├── Dashboard.jsx    # Graphiques + KPIs + bannière charge en cours
│   │       ├── Chargers.jsx     # Gestion des bornes + statut temps réel
│   │       ├── Import.jsx       # Drag & drop xlsx
│   │       ├── Sessions.jsx     # Tableau filtrable + export CSV
│   │       ├── Vehicle.jsx      # Véhicule actif + KPIs/km
│   │       └── Settings.jsx     # Configuration tarifs + règles HC/HP + alertes
│   ├── package.json
│   ├── vite.config.js
│   ├── nginx.conf
│   └── Dockerfile
├── scripts/
│   └── backup.sh                # Backup quotidien SQLite (cron)
├── docker-compose.yml
├── VERSION                      # Version unique (lue par backend + frontend)
└── .gitignore
```

### Données persistantes (volume Docker)

```
/app/data/                       # Monté depuis /srv/docker_data/evstats/ sur la VM
├── evstats.db                   # Base SQLite
├── active_charges.json          # Sessions UDP en cours (persistance restart)
├── charger_images/              # Photos des bornes
└── vehicle_images/              # Photos des véhicules
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

## Protocole UDP EVSEMaster

Le backend communique directement avec les bornes Morec via le protocole UDP propriétaire EVSEMaster (reverse-engineered depuis [evsemasterudp](https://github.com/Oniric75/evsemasterudp)).

**Port** : 28376 (écoute locale, la borne broadcast vers ce port)

**Flow d'authentification** :
```
Borne  → broadcast 0x0001 (~toutes les 5s)
Client → RequestLogin 0x8002
Borne  → LoginOK 0x0002
Client → LoginConfirm 0x8001
Client → GetStatus 0x8004
Borne  → StatusResponse 0x0004
```

**Payload StatusResponse (borne Morec MC20CAPP, offsets validés)** :

| Offset | Type | Facteur | Valeur |
|---|---|---|---|
| [1:3] | uint16 BE | ×0.1 | Tension (V) |
| [3:5] | uint16 BE | ×0.01 | Courant (A) |
| [7:9] | uint16 BE | ×1.0 | Puissance (W) |
| [15:17] | uint16 BE | ×1.0 | Compteur énergie absolu (Wh, total vie de la borne) |

> **Contrainte** : une seule session UDP à la fois. L'application EVSEMaster mobile doit être fermée pendant les requêtes du poller. Le verrou `asyncio.Lock` partagé empêche les requêtes manuelles (bouton Rafraîchir) et le poller de s'exécuter simultanément.

---

## Gestion des versions

La version est définie dans un **unique fichier `VERSION`** à la racine du repo.

- Le **backend** lit ce fichier et l'expose via `GET /api/version`
- Le **frontend** interroge cet endpoint et affiche la version dans le footer

### Incrémenter la version

```bash
echo "1.7.0" > VERSION
git add VERSION && git commit -m "chore: bump version 1.7.0"
git push
# Sur la VM :
git pull && docker compose up -d --build
```

---

## Modèle de données

### `chargingsession`

| Champ | Type | Description |
|---|---|---|
| id | INTEGER PK | Identifiant interne |
| record_id | TEXT UNIQUE | Clé de déduplication (EVSEMaster ou `UDP-{id}-{timestamp}`) |
| charger_id | TEXT | Nom de la borne |
| start_time | DATETIME | Début de session (heure locale Europe/Paris) |
| end_time | DATETIME | Fin de session (heure locale Europe/Paris) |
| duration_minutes | FLOAT | Durée en minutes |
| energy_kwh | FLOAT | Énergie consommée |
| hc_kwh | FLOAT | Part HC (calculée) |
| hp_kwh | FLOAT | Part HP (calculée) |
| cost_eur | FLOAT | Coût calculé |
| end_status | TEXT | Motif de fin : Pull Plug / Fix Time / Power Down / UDP Auto |
| start_user | TEXT | Initiateur : Clock / RFID / UDP Auto |
| source | TEXT | `xlsx` (import manuel) ou `udp` (enregistrement automatique) |

### `charger`

| Champ | Type | Description |
|---|---|---|
| id | INTEGER PK | Identifiant interne |
| name | TEXT | Nom affiché |
| ip | TEXT | Adresse IP ou FQDN |
| password | TEXT | Mot de passe 6 chiffres |
| serial | TEXT | Numéro de série hex (découvert lors du test de connexion) |
| src_port | INTEGER | Port source de la borne (défaut 6186) |
| is_enabled | BOOLEAN | Active/désactive le polling automatique |
| image_filename | TEXT | Nom du fichier photo (stocké dans `/app/data/charger_images/`) |
| last_seen | DATETIME | Dernière réponse UDP réussie |

---

## API REST

### Sessions & stats

| Méthode | Endpoint | Description |
|---|---|---|
| POST | `/api/import` | Import d'un fichier .xlsx |
| GET | `/api/sessions` | Liste paginée + filtres (end_status, start_date, end_date) |
| GET | `/api/sessions/export` | Export CSV (mêmes filtres) |
| GET | `/api/stats/daily` | Agrégats journaliers |
| GET | `/api/stats/monthly` | Agrégats mensuels |
| GET | `/api/stats/hourly` | Fréquence horaire |
| GET | `/api/imports` | Historique des imports |

### Configuration

| Méthode | Endpoint | Description |
|---|---|---|
| GET/PUT | `/api/config/tariff` | Tarifs actifs |
| GET/POST | `/api/config/tariff/periods` | Historique des périodes tarifaires |
| GET/PUT | `/api/config/tariff/rule` | Règles HC/HP configurables |
| POST | `/api/config/tariff/recalculate` | Recalcul HC/HP + coûts sur tout l'historique |
| GET/PUT | `/api/config/alert` | Configuration des alertes webhook |

### Bornes EVSE (UDP)

| Méthode | Endpoint | Description |
|---|---|---|
| GET | `/api/chargers` | Liste des bornes configurées |
| POST | `/api/chargers` | Créer une borne |
| PUT | `/api/chargers/{id}` | Modifier une borne |
| DELETE | `/api/chargers/{id}` | Supprimer une borne |
| POST | `/api/chargers/test` | Tester la connexion UDP (pré-enregistrement) |
| POST | `/api/chargers/{id}/test` | Tester la connexion UDP (borne enregistrée) |
| GET | `/api/chargers/{id}/status` | Statut temps réel via UDP |
| POST | `/api/chargers/{id}/image` | Upload photo |
| GET | `/api/chargers/live` | Cache statut de toutes les bornes (sans UDP) |
| GET | `/api/chargers/active-charge` | Sessions actives : énergie + durée en temps réel |

### Utilitaires

| Méthode | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/version` | Version de l'application |

---

## Déploiement

### Prérequis VM

- Docker + Docker Compose
- Caddy existant connecté au réseau Docker `home.lan`
- Réseau en `host` pour le backend (nécessaire pour les broadcasts UDP LAN)

### Installation

```bash
mkdir -p /srv/docker_data/evstats
cd /srv/docker_data
git clone git@gogs.home.lan:fpicard/evstats.git
cd evstats
docker compose up -d --build
```

### docker-compose.override.yml (homelab)

```yaml
services:
  evstats-api:
    volumes:
      - /srv/docker_data/evstats:/app/data
    # network_mode: host → pas de networks explicite ici

  evstats-frontend:
    ports: []
    networks:
      - home.lan

networks:
  home.lan:
    external: true
```

### Ajouter le bloc dans le Caddyfile existant

```caddy
evstats.home.lan {
    reverse_proxy evstats-frontend:80
}
```

### Mise à jour

```bash
cd /srv/docker_data/evstats
git pull
docker compose up -d --build
```

### Backup SQLite (cron)

```bash
0 3 * * * /srv/docker_data/evstats/scripts/backup.sh
```

---

## Roadmap

### v1.0.0 — MVP
- [x] Import XLSX avec déduplication (`record_id`)
- [x] Calcul HC/HP avec découpage minute-à-minute
- [x] Dashboard : KPIs, graphiques, camembert, classement des mois
- [x] Tarifs EDF configurables + recalcul global
- [x] Export CSV, script backup SQLite

### v1.1.0
- [x] Historique des tarifs EDF avec périodes de validité
- [x] Graphique fréquence horaire
- [x] Alertes consommation mensuelle (webhook ntfy/Slack/Discord)
- [x] Rapports PDF mensuels
- [x] Footer version dynamique (fichier `VERSION` unique)

### v1.2.0
- [x] Correctifs responsive mobile
- [x] Récapitulatif annuel + filtre par année

### v1.3.0
- [x] Page Véhicule : specs, photo, KPIs/km
- [x] Publication open source (GitHub, MIT)

### v1.4.0
- [x] Règles HC/HP entièrement configurables depuis l'interface
- [x] Jours entièrement HC paramétrables, plages horaires multiples

### v1.4.1 — v1.4.2
- [x] Bouton ⓘ tooltip sur les graphiques
- [x] Véhicule actif (modèle imprimante par défaut), KPIs/km sur véhicule actif uniquement

### v1.5.0
- [x] Page Chargeurs : ajout/modification/suppression, photo, FQDN
- [x] Intégration UDP directe (protocole EVSEMaster port 28376)
- [x] Test de connexion avec découverte automatique du numéro de série
- [x] Verrou asyncio : une seule session UDP à la fois

### v1.6.0
- [x] Polling automatique en arrière-plan (30 s veille, continu en charge)
- [x] Détection automatique début/fin de charge (0.5 A / 0.1 A × 3)
- [x] Enregistrement automatique des sessions UDP (HC/HP + coût calculés)
- [x] Cache statut en mémoire (page Chargeurs auto-rafraîchie)
- [x] Bannière "Charge en cours" sur le Dashboard (animation pulse)
- [x] Chip UDP sur les sessions auto-enregistrées dans le tableau Sessions

### v1.6.1
- [x] Énergie session et durée en temps réel dans la bannière (rafraîchi toutes les 5 s)
- [x] Compteur énergie hardware borne (payload [15:17]) — précis même si cycles manqués
- [x] Persistance restart-proof : `active_charges.json` dans le volume Docker
- [x] Timezone Europe/Paris : `TZ=Europe/Paris` dans docker-compose + `datetime.now()`
- [x] Script migration one-shot UTC → Europe/Paris pour les sessions existantes

### À venir
- [ ] Support du tarif Tempo EDF (Bleu/Blanc/Rouge) — nécessite intégration API RTE
- [ ] Comparaison coût électrique vs thermique (€/100km)
- [ ] Import automatique via partage de fichier (Nextcloud, etc.)

---

## Contraintes connues

- **Une seule session UDP à la fois** : l'app EVSEMaster mobile doit être fermée pendant les requêtes du poller (contrainte protocolaire). Les deux ne peuvent pas se connecter simultanément à la borne.
- **Broadcasts intermittents** : si EVSEMaster se reconnecte en arrière-plan, le poller manque des cycles. L'énergie est néanmoins correcte grâce au compteur hardware absolu.
- **Compteur hardware uint16** : overflow à 65 535 Wh (65,5 kWh) par session — suffisant pour toute session domestique usuelle.
- **Tarif Tempo EDF non supporté** : nécessite l'API RTE en temps réel pour le calendrier des couleurs de jours.

---

## Auteur

Florian PICARD — [GitHub](https://github.com/picardflo)
