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
