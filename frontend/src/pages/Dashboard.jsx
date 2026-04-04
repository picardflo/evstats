import React, { useState, useEffect, useCallback } from 'react'
import {
  Box, Typography, Grid, Paper, ToggleButtonGroup, ToggleButton,
  CircularProgress, Alert, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Tooltip as MuiTooltip,
} from '@mui/material'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import TrendingDownIcon from '@mui/icons-material/TrendingDown'
import TrendingFlatIcon from '@mui/icons-material/TrendingFlat'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, PieChart, Pie, Cell,
} from 'recharts'
import { fetchDailyStats, fetchMonthlyStats } from '../api/client'

const COLORS = { hc: '#00b4d8', hp: '#e85d04', cost: '#06d6a0', energy: '#ffd60a', savings: '#a855f7' }

function Trend({ current, previous, unit = '', invert = false }) {
  if (previous === 0 || current === previous) return <TrendingFlatIcon sx={{ fontSize: 18, color: 'text.secondary', verticalAlign: 'middle' }} />
  const pct = ((current - previous) / previous * 100).toFixed(1)
  const up = current > previous
  const good = invert ? !up : up
  return (
    <MuiTooltip title={`Mois précédent : ${previous.toFixed(2)}${unit} (${up ? '+' : ''}${pct}%)`}>
      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', ml: 0.5 }}>
        {up
          ? <TrendingUpIcon sx={{ fontSize: 18, color: good ? '#06d6a0' : '#e85d04', verticalAlign: 'middle' }} />
          : <TrendingDownIcon sx={{ fontSize: 18, color: good ? '#06d6a0' : '#e85d04', verticalAlign: 'middle' }} />}
        <Typography component="span" variant="caption" sx={{ color: good ? '#06d6a0' : '#e85d04', ml: 0.3 }}>
          {up ? '+' : ''}{pct}%
        </Typography>
      </Box>
    </MuiTooltip>
  )
}

function StatCard({ label, value, unit, color = 'primary.main', sub, trend }) {
  return (
    <Paper sx={{ p: 2.5, borderRadius: 3 }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5, mt: 0.5, flexWrap: 'wrap' }}>
        <Typography variant="h4" fontWeight={700} color={color}>
          {value}
          <Typography component="span" variant="body1" color="text.secondary" sx={{ ml: 0.5 }}>{unit}</Typography>
        </Typography>
        {trend}
      </Box>
      {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
    </Paper>
  )
}

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

const PieTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  const p = payload[0]
  return (
    <Paper sx={{ p: 1.5, borderRadius: 2 }}>
      <Typography variant="body2" color={p.payload.fill} fontWeight={700}>{p.name}</Typography>
      <Typography variant="body2">{p.value.toFixed(1)} kWh ({p.payload.percent}%)</Typography>
    </Paper>
  )
}

const renderCustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
  const RADIAN = Math.PI / 180
  const r = innerRadius + (outerRadius - innerRadius) * 0.5
  const x = cx + r * Math.cos(-midAngle * RADIAN)
  const y = cy + r * Math.sin(-midAngle * RADIAN)
  return (
    <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={14} fontWeight={700}>
      {`${(percent * 100).toFixed(1)}%`}
    </text>
  )
}

// Filtre les 30 derniers jours
function last30Days(dailyData) {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 30)
  return dailyData.filter((d) => new Date(d.date) >= cutoff)
}

export default function Dashboard() {
  const [view, setView] = useState('monthly')
  const [allDaily, setAllDaily] = useState([])
  const [allMonthly, setAllMonthly] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [daily, monthly] = await Promise.all([fetchDailyStats(), fetchMonthlyStats()])
      setAllDaily(daily)
      setAllMonthly(monthly)
    } catch {
      setError('Impossible de charger les données')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const data = view === 'daily'
    ? allDaily
    : view === '30d'
      ? last30Days(allDaily)
      : allMonthly

  const totals = data.reduce(
    (acc, d) => ({
      energy: acc.energy + d.energy_kwh,
      cost: acc.cost + d.cost_eur,
      duration: acc.duration + d.duration_minutes,
      hc: acc.hc + d.hc_kwh,
      hp: acc.hp + d.hp_kwh,
      sessions: acc.sessions + d.sessions,
      savings: acc.savings + (d.savings_eur || 0),
    }),
    { energy: 0, cost: 0, duration: 0, hc: 0, hp: 0, sessions: 0, savings: 0 }
  )

  // Tendances : comparer les 2 derniers mois
  const lastTwo = allMonthly.slice(-2)
  const prevMonth = lastTwo.length === 2 ? lastTwo[0] : null
  const currMonth = lastTwo.length >= 1 ? lastTwo[lastTwo.length - 1] : null

  const avgCostPerSession = totals.sessions > 0 ? totals.cost / totals.sessions : 0
  const avgKwhPerSession = totals.sessions > 0 ? totals.energy / totals.sessions : 0
  const effectiveCostPerKwh = totals.energy > 0 ? totals.cost / totals.energy : 0
  const hcPct = totals.energy > 0 ? (totals.hc / totals.energy) * 100 : 0
  const hpPct = 100 - hcPct

  const pieData = [
    { name: 'HC', value: totals.hc, fill: COLORS.hc, percent: hcPct.toFixed(1) },
    { name: 'HP', value: totals.hp, fill: COLORS.hp, percent: hpPct.toFixed(1) },
  ]

  const xKey = view === 'monthly' ? 'month' : 'date'

  const formatXAxis = (val) => {
    if (view === 'monthly') {
      const [y, m] = val.split('-')
      return new Date(+y, +m - 1).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })
    }
    return new Date(val).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
  }

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}><CircularProgress /></Box>
  if (error) return <Alert severity="error">{error}</Alert>

  const showTrend = view === 'monthly' && prevMonth && currMonth

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h5" fontWeight={700}>Dashboard</Typography>
        <ToggleButtonGroup value={view} exclusive onChange={(_, v) => v && setView(v)} size="small">
          <ToggleButton value="30d">30 jours</ToggleButton>
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
              <StatCard label="Sessions" value={totals.sessions} unit="" color="text.primary"
                trend={showTrend && <Trend current={currMonth.sessions} previous={prevMonth.sessions} />}
              />
            </Grid>
            <Grid item xs={6} sm={4} md={2}>
              <StatCard label="Énergie" value={totals.energy.toFixed(1)} unit="kWh" color={COLORS.energy}
                sub={`~${avgKwhPerSession.toFixed(1)} kWh/session`}
                trend={showTrend && <Trend current={currMonth.energy_kwh} previous={prevMonth.energy_kwh} unit=" kWh" />}
              />
            </Grid>
            <Grid item xs={6} sm={4} md={2}>
              <StatCard label="HC" value={totals.hc.toFixed(1)} unit="kWh" color={COLORS.hc}
                sub={`${hcPct.toFixed(1)}% de l'énergie`}
              />
            </Grid>
            <Grid item xs={6} sm={4} md={2}>
              <StatCard label="HP" value={totals.hp.toFixed(1)} unit="kWh" color={COLORS.hp}
                sub={`${hpPct.toFixed(1)}% de l'énergie`}
              />
            </Grid>
            <Grid item xs={6} sm={4} md={2}>
              <StatCard label="Coût total" value={totals.cost.toFixed(2)} unit="€" color={COLORS.cost}
                sub={`${avgCostPerSession.toFixed(2)} €/session · ${(effectiveCostPerKwh * 100).toFixed(2)} c€/kWh`}
                trend={showTrend && <Trend current={currMonth.cost_eur} previous={prevMonth.cost_eur} unit=" €" invert />}
              />
            </Grid>
            <Grid item xs={6} sm={4} md={2}>
              <StatCard label="Économies vs 100% HP" value={totals.savings.toFixed(2)} unit="€" color={COLORS.savings}
                sub={`grâce aux HC/Week-end/Mer`}
                trend={showTrend && <Trend current={currMonth.savings_eur} previous={prevMonth.savings_eur} unit=" €" />}
              />
            </Grid>
          </Grid>

          {/* Répartition HC/HP + graphique énergie */}
          <Grid container spacing={3} sx={{ mb: 3 }}>
            <Grid item xs={12} md={4}>
              <Paper sx={{ p: 3, borderRadius: 3, height: '100%', display: 'flex', flexDirection: 'column' }}>
                <Typography variant="h6" fontWeight={600} gutterBottom>Répartition HC / HP</Typography>
                <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <PieChart width={220} height={220}>
                    <Pie data={pieData} cx={110} cy={110} outerRadius={95} dataKey="value" labelLine={false} label={renderCustomLabel}>
                      {pieData.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
                    </Pie>
                    <Tooltip content={<PieTooltip />} />
                  </PieChart>
                  <Box sx={{ display: 'flex', gap: 3, mt: 1 }}>
                    {pieData.map((entry) => (
                      <Box key={entry.name} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: entry.fill }} />
                        <Typography variant="body2" color="text.secondary">{entry.name} — {entry.percent}%</Typography>
                      </Box>
                    ))}
                  </Box>
                  <Typography variant="body2" color={COLORS.savings} sx={{ mt: 2, fontWeight: 600 }}>
                    Économie totale : {totals.savings.toFixed(2)} €
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    vs facturation 100% HP
                  </Typography>
                </Box>
              </Paper>
            </Grid>

            <Grid item xs={12} md={8}>
              <Paper sx={{ p: 3, borderRadius: 3 }}>
                <Typography variant="h6" fontWeight={600} gutterBottom>Consommation HC / HP (kWh)</Typography>
                <ResponsiveContainer width="100%" height={260}>
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
            </Grid>
          </Grid>

          {/* Coût + Économies */}
          <Paper sx={{ p: 3, borderRadius: 3, mb: 3 }}>
            <Typography variant="h6" fontWeight={600} gutterBottom>Coût réel vs économies réalisées (€)</Typography>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey={xKey} tickFormatter={formatXAxis} tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} unit=" €" width={60} />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                <Bar dataKey="cost_eur" name="Coût réel €" fill={COLORS.cost} radius={[0, 0, 0, 0]} stackId="a" />
                <Bar dataKey="savings_eur" name="Économies €" fill={COLORS.savings} radius={[4, 4, 0, 0]} stackId="a" />
              </BarChart>
            </ResponsiveContainer>
          </Paper>

          {/* Durée */}
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

          {/* Classement mois */}
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
                      <TableCell align="right">HC</TableCell>
                      <TableCell align="right">HP</TableCell>
                      <TableCell align="right">% HC</TableCell>
                      <TableCell align="right">Coût (€)</TableCell>
                      <TableCell align="right">Moy/session</TableCell>
                      <TableCell align="right">Économies (€)</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {[...data]
                      .sort((a, b) => b.energy_kwh - a.energy_kwh)
                      .map((row, i) => {
                        const pct = row.energy_kwh > 0 ? (row.hc_kwh / row.energy_kwh * 100).toFixed(1) : '0.0'
                        const avg = row.sessions > 0 ? (row.cost_eur / row.sessions).toFixed(2) : '0.00'
                        return (
                          <TableRow key={row.month} hover>
                            <TableCell>{i + 1}</TableCell>
                            <TableCell>
                              {new Date(row.month + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}
                            </TableCell>
                            <TableCell align="right">{row.sessions}</TableCell>
                            <TableCell align="right">{row.energy_kwh.toFixed(2)}</TableCell>
                            <TableCell align="right" sx={{ color: COLORS.hc }}>{row.hc_kwh.toFixed(2)}</TableCell>
                            <TableCell align="right" sx={{ color: COLORS.hp }}>{row.hp_kwh.toFixed(2)}</TableCell>
                            <TableCell align="right" sx={{ color: COLORS.hc }}>{pct}%</TableCell>
                            <TableCell align="right" sx={{ color: COLORS.cost }}>{row.cost_eur.toFixed(2)}</TableCell>
                            <TableCell align="right">{avg}</TableCell>
                            <TableCell align="right" sx={{ color: COLORS.savings }}>{(row.savings_eur || 0).toFixed(2)}</TableCell>
                          </TableRow>
                        )
                      })}
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
