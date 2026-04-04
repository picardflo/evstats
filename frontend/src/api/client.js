import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
})

export async function importXlsx(file) {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post('/import', form)
  return data
}

export async function fetchSessions(params) {
  const { data } = await api.get('/sessions', { params })
  return data
}

export async function fetchDailyStats(params) {
  const { data } = await api.get('/stats/daily', { params })
  return data
}

export async function fetchMonthlyStats() {
  const { data } = await api.get('/stats/monthly')
  return data
}

export async function fetchImports() {
  const { data } = await api.get('/imports')
  return data
}

export async function fetchTariffConfig() {
  const { data } = await api.get('/config/tariff')
  return data
}

export async function updateTariffConfig(payload) {
  const { data } = await api.put('/config/tariff', payload)
  return data
}

export async function recalculateCosts() {
  const { data } = await api.post('/config/tariff/recalculate')
  return data
}

export function buildExportUrl(params = {}) {
  const q = new URLSearchParams()
  if (params.end_status) q.set('end_status', params.end_status)
  if (params.start_date) q.set('start_date', params.start_date)
  if (params.end_date) q.set('end_date', params.end_date)
  return `/api/sessions/export?${q.toString()}`
}
