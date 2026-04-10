/**
 * Page Sessions — tableau paginé des sessions de charge.
 *
 * Filtres disponibles :
 *  - Statut de fin (Pull Plug / Fix Time / Power Down / Tous)
 *  - Date début / Date fin (filtre sur start_time)
 *
 * Pagination : côté serveur (le backend ne retourne que la page demandée).
 * Les filtres réinitialisent la page à 0 pour éviter les pages vides.
 *
 * Export CSV : le bouton génère un lien direct vers /api/sessions/export
 * avec les mêmes filtres actifs — le navigateur déclenche le téléchargement.
 */
import React, { useState, useEffect, useCallback } from 'react'
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TablePagination, Chip, TextField, MenuItem,
  Grid, CircularProgress, Alert, Button, Dialog, DialogTitle,
  DialogContent, DialogActions, IconButton, Tooltip,
} from '@mui/material'
import DownloadIcon from '@mui/icons-material/Download'
import WifiIcon from '@mui/icons-material/Wifi'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import { fetchSessions, buildExportUrl, patchSession, deleteSession } from '../api/client'

const STATUS_COLORS = {
  'Pull Plug': 'success',
  'Fix Time': 'info',
  'Power Down': 'warning',
}

const STATUS_OPTIONS = ['Tous', 'Pull Plug', 'Fix Time', 'Power Down']

function formatDuration(minutes) {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return h > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${m}min`
}

function toLocalDatetimeInput(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function Sessions() {
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(20)
  const [endStatus, setEndStatus] = useState('Tous')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [data, setData] = useState({ total: 0, items: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Edit dialog
  const [editSession, setEditSession] = useState(null)
  const [editEnergy, setEditEnergy] = useState('')
  const [editStart, setEditStart] = useState('')
  const [editEnd, setEditEnd] = useState('')
  const [saving, setSaving] = useState(false)

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = { page: page + 1, page_size: rowsPerPage }
      if (endStatus !== 'Tous') params.end_status = endStatus
      if (startDate) params.start_date = startDate
      if (endDate) params.end_date = endDate
      const d = await fetchSessions(params)
      setData(d)
    } catch {
      setError('Impossible de charger les sessions')
    } finally {
      setLoading(false)
    }
  }, [page, rowsPerPage, endStatus, startDate, endDate])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(0) }, [endStatus, startDate, endDate])

  const openEdit = (s) => {
    setEditSession(s)
    setEditEnergy(String(s.energy_kwh))
    setEditStart(toLocalDatetimeInput(s.start_time))
    setEditEnd(toLocalDatetimeInput(s.end_time))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const payload = {}
      const newEnergy = parseFloat(editEnergy)
      if (!isNaN(newEnergy) && newEnergy !== editSession.energy_kwh) payload.energy_kwh = newEnergy
      if (editStart) payload.start_time = new Date(editStart).toISOString()
      if (editEnd)   payload.end_time   = new Date(editEnd).toISOString()
      await patchSession(editSession.id, payload)
      setEditSession(null)
      load()
    } catch {
      setError('Erreur lors de la sauvegarde')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await deleteSession(deleteTarget.id)
      setDeleteTarget(null)
      load()
    } catch {
      setError('Erreur lors de la suppression')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h5" fontWeight={700}>Sessions de charge</Typography>
        <Button
          variant="outlined"
          size="small"
          startIcon={<DownloadIcon />}
          href={buildExportUrl({ end_status: endStatus !== 'Tous' ? endStatus : undefined, start_date: startDate || undefined, end_date: endDate || undefined })}
          download="sessions.csv"
        >
          Export CSV
        </Button>
      </Box>

      {/* Filtres */}
      <Paper sx={{ p: 2, mb: 3, borderRadius: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={4} md={3}>
            <TextField
              select fullWidth size="small" label="Statut fin"
              value={endStatus} onChange={(e) => setEndStatus(e.target.value)}
            >
              {STATUS_OPTIONS.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={4} md={3}>
            <TextField
              fullWidth size="small" label="Date début" type="date"
              InputLabelProps={{ shrink: true }}
              value={startDate} onChange={(e) => setStartDate(e.target.value)}
            />
          </Grid>
          <Grid item xs={12} sm={4} md={3}>
            <TextField
              fullWidth size="small" label="Date fin" type="date"
              InputLabelProps={{ shrink: true }}
              value={endDate} onChange={(e) => setEndDate(e.target.value)}
            />
          </Grid>
        </Grid>
      </Paper>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Paper sx={{ borderRadius: 3 }}>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={{ minWidth: 600 }}>
            <TableHead>
              <TableRow>
                <TableCell>Début</TableCell>
                <TableCell>Fin</TableCell>
                <TableCell align="right">Durée</TableCell>
                <TableCell align="right">Énergie (kWh)</TableCell>
                <TableCell align="right">HC (kWh)</TableCell>
                <TableCell align="right">HP (kWh)</TableCell>
                <TableCell align="right">Coût (€)</TableCell>
                <TableCell>Statut</TableCell>
                <TableCell align="center">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={9} align="center" sx={{ py: 4 }}>
                    <CircularProgress size={28} />
                  </TableCell>
                </TableRow>
              ) : data.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                    Aucune session trouvée
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((s) => (
                  <TableRow key={s.id} hover>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {new Date(s.start_time).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {new Date(s.end_time).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
                    </TableCell>
                    <TableCell align="right">{formatDuration(s.duration_minutes)}</TableCell>
                    <TableCell align="right">{s.energy_kwh.toFixed(2)}</TableCell>
                    <TableCell align="right" sx={{ color: '#00b4d8' }}>{s.hc_kwh.toFixed(2)}</TableCell>
                    <TableCell align="right" sx={{ color: '#e85d04' }}>{s.hp_kwh.toFixed(2)}</TableCell>
                    <TableCell align="right" sx={{ color: '#06d6a0', fontWeight: 600 }}>
                      {s.cost_eur.toFixed(3)}
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        <Chip
                          label={s.end_status}
                          color={STATUS_COLORS[s.end_status] || 'default'}
                          size="small" variant="outlined"
                        />
                        {s.source === 'udp' && (
                          <Chip
                            icon={<WifiIcon sx={{ fontSize: '12px !important' }} />}
                            label="UDP" size="small"
                            sx={{
                              bgcolor: 'rgba(0,180,216,0.12)', color: '#00b4d8',
                              border: '1px solid rgba(0,180,216,0.4)',
                              fontWeight: 600, fontSize: '0.65rem',
                            }}
                          />
                        )}
                      </Box>
                    </TableCell>
                    <TableCell align="center">
                      <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                        <Tooltip title="Modifier">
                          <IconButton size="small" onClick={() => openEdit(s)}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Supprimer">
                          <IconButton size="small" color="error" onClick={() => setDeleteTarget(s)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={data.total}
          page={page}
          onPageChange={(_, p) => setPage(p)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => { setRowsPerPage(+e.target.value); setPage(0) }}
          rowsPerPageOptions={[20, 50, 100]}
          labelRowsPerPage="Lignes :"
          labelDisplayedRows={({ from, to, count }) => `${from}–${to} sur ${count}`}
        />
      </Paper>

      {/* Dialog édition */}
      <Dialog open={!!editSession} onClose={() => setEditSession(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Modifier la session</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}>
          <TextField
            label="Début" type="datetime-local"
            InputLabelProps={{ shrink: true }}
            value={editStart}
            onChange={(e) => setEditStart(e.target.value)}
            fullWidth size="small"
          />
          <TextField
            label="Fin" type="datetime-local"
            InputLabelProps={{ shrink: true }}
            value={editEnd}
            onChange={(e) => setEditEnd(e.target.value)}
            fullWidth size="small"
          />
          <TextField
            label="Énergie (kWh)" type="number"
            inputProps={{ step: '0.01', min: '0' }}
            value={editEnergy}
            onChange={(e) => setEditEnergy(e.target.value)}
            fullWidth size="small"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditSession(null)}>Annuler</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? 'Sauvegarde...' : 'Enregistrer'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog confirmation suppression */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Supprimer la session ?</DialogTitle>
        <DialogContent>
          {deleteTarget && (
            <Typography>
              {new Date(deleteTarget.start_time).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
              {' → '}
              {new Date(deleteTarget.end_time).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
              {' · '}{deleteTarget.energy_kwh.toFixed(2)} kWh
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Annuler</Button>
          <Button variant="contained" color="error" onClick={handleDelete} disabled={deleting}>
            {deleting ? 'Suppression...' : 'Supprimer'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
