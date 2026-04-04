/**
 * Client API — EVSE Stats
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
