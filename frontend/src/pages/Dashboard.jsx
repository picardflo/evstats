import React, { useState, useEffect, useCallback } from 'react'
import {
  Box, Typography, Grid, Paper, ToggleButtonGroup, ToggleButton,
  CircularProgress, Alert, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow,
} from '@mui/material'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend,
} from 'recharts'
import { fetchDailyStats, fetchMonthlyStats } from '../api/client'

function StatCard({ label, value, unit, color = 'primary.main' }) {
  return (
    <Paper sx={{ p: 2.5, borderRadius: 3 }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography variant="h4" fontWeight={700} color={color} sx={{ mt: 0.5 }}>
        {value}
        <Typography component="span" variant="body1" color="text.secondary" sx={{ ml: 0.5 }}>{unit}</Typography>
      </Typography>
    </Paper>
  )
}

const COLORS = { hc: '#00b4d8', hp: '#e85d04', cost: '#06d6a0', energy: '#ffd60a' }

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <Paper sx={{ p: 1.5, borderRadius: 2, minWidth: 160 }}>
      <Typography variant="body2" fontWeight={700} gutterBottom>{label}</Typography>
      {payload.map((p) => (
        <Box key={p.name} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
          <Typography variant="body2" color={p.fill}>{p.name}</Typography>
          <Typography variant="body2">{typeof p.value === 'number' ? p.value.toFixed(2) : p.value}</Typography>
        </Box>
      ))}
    </Paper>
  )
}

export default function Dashboard() {
  const [view, setView] = useState('monthly')
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const d = view === 'daily' ? await fetchDailyStats() : await fetchMonthlyStats()
      setData(d)
    } catch {
      setError('Impossible de charger les données')
    } finally {
      setLoading(false)
    }
  }, [view])

  useEffect(() => { load() }, [load])

  const totals = data.reduce(
    (acc, d) => ({
      energy: acc.energy + d.energy_kwh,
      cost: acc.cost + d.cost_eur,
      duration: acc.duration + d.duration_minutes,
      hc: acc.hc + d.hc_kwh,
      hp: acc.hp + d.hp_kwh,
      sessions: acc.sessions + d.sessions,
    }),
    { energy: 0, cost: 0, duration: 0, hc: 0, hp: 0, sessions: 0 }
  )

  const xKey = view === 'daily' ? 'date' : 'month'

  const formatXAxis = (val) => {
    if (view === 'monthly') {
      const [y, m] = val.split('-')
      return new Date(+y, +m - 1).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })
    }
    return new Date(val).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
  }

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}><CircularProgress /></Box>
  if (error) return <Alert severity="error">{error}</Alert>

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h5" fontWeight={700}>Dashboard</Typography>
        <ToggleButtonGroup value={view} exclusive onChange={(_, v) => v && setView(v)} size="small">
          <ToggleButton value="daily">Journalier</ToggleButton>
          <ToggleButton value="monthly">Mensuel</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {data.length === 0 ? (
        <Alert severity="info">Aucune donnée. Importez un fichier XLSX pour commencer.</Alert>
      ) : (
        <>
          {/* KPI Cards */}
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid item xs={6} sm={4} md={2}>
              <StatCard label="Sessions" value={totals.sessions} unit="" color="text.primary" />
            </Grid>
            <Grid item xs={6} sm={4} md={2}>
              <StatCard label="Énergie" value={totals.energy.toFixed(1)} unit="kWh" color={COLORS.energy} />
            </Grid>
            <Grid item xs={6} sm={4} md={2}>
              <StatCard label="HC" value={totals.hc.toFixed(1)} unit="kWh" color={COLORS.hc} />
            </Grid>
            <Grid item xs={6} sm={4} md={2}>
              <StatCard label="HP" value={totals.hp.toFixed(1)} unit="kWh" color={COLORS.hp} />
            </Grid>
            <Grid item xs={6} sm={4} md={2}>
              <StatCard label="Durée" value={(totals.duration / 60).toFixed(1)} unit="h" color="secondary.main" />
            </Grid>
            <Grid item xs={6} sm={4} md={2}>
              <StatCard label="Coût total" value={totals.cost.toFixed(2)} unit="€" color={COLORS.cost} />
            </Grid>
          </Grid>

          {/* Graphique Énergie HC/HP */}
          <Paper sx={{ p: 3, borderRadius: 3, mb: 3 }}>
            <Typography variant="h6" fontWeight={600} gutterBottom>Consommation HC / HP (kWh)</Typography>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey={xKey} tickFormatter={formatXAxis} tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} unit=" kWh" width={70} />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                <Bar dataKey="hc_kwh" name="HC" stackId="a" fill={COLORS.hc} radius={[0, 0, 0, 0]} />
                <Bar dataKey="hp_kwh" name="HP" stackId="a" fill={COLORS.hp} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Paper>

          {/* Graphique Coût */}
          <Paper sx={{ p: 3, borderRadius: 3, mb: 3 }}>
            <Typography variant="h6" fontWeight={600} gutterBottom>Coût (€)</Typography>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey={xKey} tickFormatter={formatXAxis} tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} unit=" €" width={60} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="cost_eur" name="Coût €" fill={COLORS.cost} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Paper>

          {/* Graphique Durée */}
          <Paper sx={{ p: 3, borderRadius: 3, mb: 3 }}>
            <Typography variant="h6" fontWeight={600} gutterBottom>Durée de charge (min)</Typography>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey={xKey} tickFormatter={formatXAxis} tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} unit=" min" width={70} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="duration_minutes" name="Durée (min)" fill="#7c3aed" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Paper>

          {/* Top mois */}
          {view === 'monthly' && (
            <Paper sx={{ p: 3, borderRadius: 3 }}>
              <Typography variant="h6" fontWeight={600} gutterBottom>Classement des mois</Typography>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>#</TableCell>
                      <TableCell>Mois</TableCell>
                      <TableCell align="right">Sessions</TableCell>
                      <TableCell align="right">Énergie (kWh)</TableCell>
                      <TableCell align="right">HC (kWh)</TableCell>
                      <TableCell align="right">HP (kWh)</TableCell>
                      <TableCell align="right">Coût (€)</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {[...data]
                      .sort((a, b) => b.energy_kwh - a.energy_kwh)
                      .map((row, i) => (
                        <TableRow key={row.month} hover>
                          <TableCell>{i + 1}</TableCell>
                          <TableCell>
                            {new Date(row.month + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}
                          </TableCell>
                          <TableCell align="right">{row.sessions}</TableCell>
                          <TableCell align="right">{row.energy_kwh.toFixed(2)}</TableCell>
                          <TableCell align="right" sx={{ color: COLORS.hc }}>{row.hc_kwh.toFixed(2)}</TableCell>
                          <TableCell align="right" sx={{ color: COLORS.hp }}>{row.hp_kwh.toFixed(2)}</TableCell>
                          <TableCell align="right" sx={{ color: COLORS.cost }}>{row.cost_eur.toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          )}
        </>
      )}
    </Box>
  )
}
