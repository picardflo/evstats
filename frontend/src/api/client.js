/**
 * Client API — EVSE Stats V2
 *
 * Toutes les requêtes vers le backend FastAPI passent par ce module.
 * Le baseURL "/api" est proxifié par Nginx (prod) ou Vite (dev) vers http://localhost:8000.
 *
 * En dev : proxy configuré dans vite.config.js
 * En prod : proxy configuré dans nginx.conf (evstats-api:8000)
 */

import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
})


// ── Import ────────────────────────────────────────────────────────────────────

/**
 * Envoie un fichier .xlsx pour import.
 * @param {File} file - Fichier sélectionné par l'utilisateur
 * @returns {Promise<{filename, total_rows, new_rows, duplicate_rows}>}
 */
export async function importXlsx(file) {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post('/import', form)
  return data
}


// ── Sessions ──────────────────────────────────────────────────────────────────

/**
 * Récupère une page de sessions avec filtres optionnels.
 * @param {Object} params - { page, page_size, end_status, start_date, end_date }
 * @returns {Promise<{total: number, items: Session[]}>}
 */
export async function fetchSessions(params) {
  const { data } = await api.get('/sessions', { params })
  return data
}

/**
 * Construit l'URL de téléchargement CSV avec les filtres actifs.
 * Utilisé directement dans un attribut href (pas de fetch).
 * @param {Object} params - { end_status, start_date, end_date }
 * @returns {string} URL relative vers /api/sessions/export
 */
export function buildExportUrl(params = {}) {
  const q = new URLSearchParams()
  if (params.end_status) q.set('end_status', params.end_status)
  if (params.start_date) q.set('start_date', params.start_date)
  if (params.end_date)   q.set('end_date', params.end_date)
  return `/api/sessions/export?${q.toString()}`
}


// ── Stats ─────────────────────────────────────────────────────────────────────

/**
 * Récupère les agrégats journaliers.
 * @param {Object} params - { start_date, end_date } (optionnels)
 * @returns {Promise<DailyStats[]>}
 */
export async function fetchDailyStats(params) {
  const { data } = await api.get('/stats/daily', { params })
  return data
}

/**
 * Récupère les agrégats mensuels (toutes les sessions).
 * @returns {Promise<MonthlyStats[]>}
 */
export async function fetchMonthlyStats() {
  const { data } = await api.get('/stats/monthly')
  return data
}


// ── Historique imports ────────────────────────────────────────────────────────

/**
 * Récupère l'historique des imports (du plus récent au plus ancien).
 * @returns {Promise<ImportLog[]>}
 */
export async function fetchImports() {
  const { data } = await api.get('/imports')
  return data
}


// ── Configuration tarifaire ───────────────────────────────────────────────────

/**
 * Récupère les tarifs EDF actifs.
 * @returns {Promise<{price_hc: number, price_hp: number, updated_at: string}>}
 */
export async function fetchTariffConfig() {
  const { data } = await api.get('/config/tariff')
  return data
}

/**
 * Met à jour les tarifs EDF.
 * @param {{ price_hc: number, price_hp: number }} payload - Prix en €/kWh
 * @returns {Promise<TariffConfig>}
 */
export async function updateTariffConfig(payload) {
  const { data } = await api.put('/config/tariff', payload)
  return data
}

/**
 * Déclenche le recalcul des coûts sur toutes les sessions existantes.
 * Utile après un changement de tarif EDF.
 * @returns {Promise<{updated: number, price_hc: number, price_hp: number}>}
 */
export async function recalculateCosts() {
  const { data } = await api.post('/config/tariff/recalculate')
  return data
}

// ── Périodes tarifaires (V2) ──────────────────────────────────────────────────

export async function fetchTariffPeriods() {
  const { data } = await api.get('/config/tariff/periods')
  return data
}

export async function addTariffPeriod(payload) {
  const { data } = await api.post('/config/tariff/periods', payload)
  return data
}

export async function deleteTariffPeriod(id) {
  await api.delete(`/config/tariff/periods/${id}`)
}

// ── Règles HC/HP (V2) ────────────────────────────────────────────────────────

/**
 * Récupère les règles HC/HP configurées.
 * @returns {Promise<{full_hc_days: number[], hc_windows: Object[], label: string, updated_at: string}>}
 */
export async function fetchTariffRule() {
  const { data } = await api.get('/config/tariff-rule')
  return data
}

/**
 * Met à jour les règles HC/HP.
 * @param {{ full_hc_days: number[], hc_windows: Object[], label: string }} payload
 */
export async function updateTariffRule(payload) {
  const { data } = await api.put('/config/tariff-rule', payload)
  return data
}

// ── Stats horaires (V2) ───────────────────────────────────────────────────────

export async function fetchHourlyStats() {
  const { data } = await api.get('/stats/hourly')
  return data
}

// ── Alertes (V2) ─────────────────────────────────────────────────────────────

export async function fetchAlertConfig() {
  const { data } = await api.get('/alerts')
  return data
}

export async function updateAlertConfig(payload) {
  const { data } = await api.put('/alerts', payload)
  return data
}

export async function checkAlerts() {
  const { data } = await api.post('/alerts/check')
  return data
}

// ── Rapport PDF (V2) ──────────────────────────────────────────────────────────

/**
 * Construit l'URL de téléchargement du rapport PDF mensuel.
 * @param {number} year
 * @param {number} month
 */
export function buildPdfReportUrl(year, month) {
  return `/api/reports/monthly/${year}/${month}`
}

// ── Véhicules (V2) ───────────────────────────────────────────────────────────

export async function fetchVehicles() {
  const { data } = await api.get('/vehicles')
  return data
}

export async function createVehicle(payload) {
  const { data } = await api.post('/vehicles', payload)
  return data
}

export async function updateVehicle(id, payload) {
  const { data } = await api.put(`/vehicles/${id}`, payload)
  return data
}

export async function deleteVehicle(id) {
  await api.delete(`/vehicles/${id}`)
}

export async function setActiveVehicle(id) {
  const { data } = await api.post(`/vehicles/${id}/set-active`)
  return data
}

export async function uploadVehicleImage(id, file) {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post(`/vehicles/${id}/image`, form)
  return data
}

/** URL directe vers l'image d'un véhicule (utilisé dans <img src=...>) */
export function vehicleImageUrl(id) {
  return `/api/vehicles/${id}/image`
}

// ── Bornes EVSE / UDP (V2) ────────────────────────────────────────────────────

export async function fetchChargers() {
  const { data } = await api.get('/chargers')
  return data
}

export async function createCharger(payload) {
  const { data } = await api.post('/chargers', payload)
  return data
}

export async function updateCharger(id, payload) {
  const { data } = await api.put(`/chargers/${id}`, payload)
  return data
}

export async function deleteCharger(id) {
  await api.delete(`/chargers/${id}`)
}

/**
 * Teste la connexion UDP à une borne AVANT de l'enregistrer.
 * @param {{ ip: string, password: string }} payload
 * @returns {Promise<{ serial, src_port, voltage, current, power_w, is_charging }>}
 */
export async function testChargerPreSave(payload) {
  const { data } = await api.post('/chargers/test', payload, { timeout: 25000 })
  return data
}

/**
 * Teste la connexion UDP d'une borne enregistrée.
 * @param {number} id
 */
export async function testCharger(id) {
  const { data } = await api.post(`/chargers/${id}/test`, {}, { timeout: 25000 })
  return data
}

/**
 * Récupère le statut temps réel d'une borne (tension, courant, puissance).
 * @param {number} id
 * @returns {Promise<{ voltage, current, power_w, is_charging, last_seen }>}
 */
export async function fetchChargerStatus(id) {
  const { data } = await api.get(`/chargers/${id}/status`, { timeout: 25000 })
  return data
}

/**
 * Retourne le statut en cache de toutes les bornes (lu par le poller, pas de requête UDP).
 * @returns {Promise<{ [chargerId]: { voltage, current, power_w, is_charging, updated_at, error } }>}
 */
export async function fetchAllChargersLive() {
  const { data } = await api.get('/chargers/live')
  return data
}

export async function uploadChargerImage(id, file) {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post(`/chargers/${id}/image`, form)
  return data
}

export function chargerImageUrl(id) {
  return `/api/chargers/${id}/image`
}

// ── Version ───────────────────────────────────────────────────────────────────

export async function fetchVersion() {
  const { data } = await api.get('/version')
  return data.version
}
