# 📊 EVSE Stats WebUI (Morec / EVSEMaster)

## 🎯 Objectif

Développer une interface web (GUI) permettant de visualiser et analyser les données de charge issues de l’application **EVSEMaster**, via l’import de fichiers Excel (.xlsx).

En l’absence d’API fournie par la borne Morec ou l’application EVSEMaster, cette solution repose exclusivement sur des exports manuels réguliers.

---

## ⚙️ Fonctionnalités

### 📥 Import des données
- Import manuel de fichiers **.xlsx**
- Gestion des imports **différentiels** (déduplication des sessions)
- Historisation des imports

### 🔄 Traitement des données

Extraction des informations depuis l’export EVSEMaster :

- Numéro d'enregistrement
- Numéro de chargeur
- Date et heure de début de charge
- Date et heure de fin de charge
- Durée de charge (minutes)
- Énergie consommée (kWh)
- Utilisateur de début
- Utilisateur de fin (utilisé comme statut / motif de fin)

> ⚠️ Note : l’export EVSEMaster ne fournit pas toujours un état explicite de la borne.  
> Le champ `Utilisateur de fin` est utilisé comme **statut de fin de session** (ex : Pull Plug, Fix Time, Power Down).

---

## 💡 Gestion du contrat EDF

### 🕒 Option tarifaire
**Heures Creuses + Week-end + Mercredi**

### ⚡ Puissance
12 kVA

### 💰 Tarification (au 16/03/2026)

| Type                     | Prix (c€/kWh) |
|--------------------------|--------------|
| HC semaine               | 17,24        |
| HP semaine               | 23,05        |
| HC week-end              | 17,24        |
| HP week-end              | 17,24        |
| HC mercredi              | 17,24        |
| HP mercredi              | 17,24        |

### ⏱️ Règles

- HC semaine : **23h30 → 07h30** (hors mercredi)
- Mercredi : **100% heures creuses**
- Week-end : **100% heures creuses**

### 🧮 Calculs attendus

- Calcul du coût de chaque session de charge
- Gestion des sessions chevauchant plusieurs plages tarifaires
- Agrégation :
  - par jour
  - par mois
- Répartition HP / HC

---

## 📈 Visualisations

### Graphiques

- 🔋 Consommation (kWh)
  - Vue journalière
  - Vue mensuelle

- ⏱️ Durée de charge (minutes)
  - Vue journalière
  - Vue mensuelle

- 💰 Coût (€)
  - Vue journalière
  - Vue mensuelle

### Tableaux

- 📊 Classement des mois les plus consommateurs
- 📅 Historique des sessions
- 🔍 Détail des sessions (filtrable)

---

## 🏗️ Architecture technique

### 🧱 Stack recommandée

#### Backend
- Python **FastAPI**
- ORM : **SQLModel** ou **SQLAlchemy**
- Parsing XLSX : **pandas** / **openpyxl**

#### Frontend
- **React (Vite)**
- UI : **Material UI (MUI)**
- Charts : **Recharts** ou **Chart.js**

#### Base de données
- **SQLite**

---

## 🗄️ Modèle de données (proposition)

### Table: `charging_sessions`

| Champ              | Type        | Description |
|-------------------|-------------|-------------|
| id                | INTEGER PK  | Identifiant |
| record_id         | TEXT        | Numéro d'enregistrement |
| charger_id        | TEXT        | Numéro de chargeur |
| start_time        | DATETIME    | Début charge |
| end_time          | DATETIME    | Fin charge |
| duration_minutes  | FLOAT       | Durée |
| energy_kwh        | FLOAT       | Énergie |
| cost_eur          | FLOAT       | Coût calculé |
| tariff_split      | JSON        | Détail HP / HC |
| end_status        | TEXT        | Statut fin (Pull Plug, etc.) |
| import_hash       | TEXT        | Hash pour déduplication |

---

## 🔌 Déploiement

### 🐳 Environnement
- Docker
- Reverse proxy : **Caddy**
- Domaine : `*.home.lan`

### 🌐 URL cible
https://evstats.home.lan/

---

## 🚀 Roadmap

### MVP
- [ ] Import XLSX
- [ ] Parsing EVSEMaster
- [ ] Stockage SQLite
- [ ] Calcul HP / HC simple
- [ ] Dashboard basique

### V1
- [ ] Gestion complète des chevauchements horaires
- [ ] Graphiques avancés
- [ ] Historique détaillé

### V2 (optionnel)
- [ ] Authentification
- [ ] Export CSV / PDF
- [ ] Alertes consommation
- [ ] Automatisation import

---

## ⚠️ Contraintes

- Pas d’API côté borne Morec
- Pas d’API EVSEMaster
- Dépendance aux exports manuels XLSX
- Format de données potentiellement variable

---

## 🎨 UX / UI

- Design moderne inspiré **Material Design**
- Dashboard clair et lisible
- Responsive (desktop + mobile)

---

## 📌 Notes

Ce projet vise à combler l’absence d’outils avancés de monitoring pour les bornes Morec en proposant une solution autonome, légère et extensible.

---

## 👨‍💻 Auteur

Florian Marchand