/**
 * Page Paramètres — configuration des tarifs EDF.
 *
 * V2 : gestion complète de l'historique des périodes tarifaires.
 * Chaque période a une date d'entrée en vigueur, les coûts sont
 * recalculés avec le bon tarif selon la date de chaque session.
 *
 * Workflow utilisateur :
 *  1. "Ajouter une période" → renseigner date, HC, HP, libellé
 *  2. "Recalculer" → applique les bons tarifs historiques à toutes les sessions
 *  3. Supprimer une période si erreur de saisie
 */
import React, { useState, useEffect, useCallback } from 'react'
import {
  Box, Typography, Paper, TextField, Button, Alert, CircularProgress,
  Divider, Grid, Chip, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, IconButton, Dialog, DialogTitle, DialogContent,
  DialogActions, Checkbox, FormControlLabel, FormGroup,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import RecyclingIcon from '@mui/icons-material/Recycling'
import SaveIcon from '@mui/icons-material/Save'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import {
  fetchTariffConfig, fetchTariffPeriods, addTariffPeriod,
  deleteTariffPeriod, recalculateCosts, fetchTariffRule, updateTariffRule,
} from '../api/client'

const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

function fmtTime(h, m) {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
function parseTime(str) {
  const [h, m] = (str || '00:00').split(':').map(Number)
  return { h: isNaN(h) ? 0 : h, m: isNaN(m) ? 0 : m }
}

export default function Settings() {
  const [config, setConfig]         = useState(null)
  const [periods, setPeriods]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [recalcLoading, setRecalcLoading] = useState(false)
  const [success, setSuccess]       = useState(null)
  const [error, setError]           = useState(null)

  // Formulaire nouvelle période tarifaire
  const [dialogOpen, setDialogOpen] = useState(false)
  const [newFrom, setNewFrom]       = useState('')
  const [newHc, setNewHc]           = useState('')
  const [newHp, setNewHp]           = useState('')
  const [newLabel, setNewLabel]     = useState('')
  const [addLoading, setAddLoading] = useState(false)

  // Règles HC/HP éditables
  const [rule, setRule]             = useState(null)
  const [editDays, setEditDays]     = useState([])
  const [editWindows, setEditWindows] = useState([])
  const [editLabel, setEditLabel]   = useState('')
  const [ruleLoading, setRuleLoading] = useState(false)
  // Formulaire ajout plage HC
  const [newWinStart, setNewWinStart] = useState('23:30')
  const [newWinEnd, setNewWinEnd]     = useState('07:30')

  const loadData = useCallback(async () => {
    try {
      const [cfg, ps, rl] = await Promise.all([
        fetchTariffConfig(), fetchTariffPeriods(), fetchTariffRule(),
      ])
      setConfig(cfg)
      setPeriods(ps)
      setRule(rl)
      setEditDays(rl.full_hc_days)
      setEditWindows(rl.hc_windows)
      setEditLabel(rl.label)
    } catch {
      setError('Impossible de charger la configuration')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const handleAdd = async () => {
    setAddLoading(true)
    setSuccess(null)
    setError(null)
    try {
      await addTariffPeriod({
        valid_from: newFrom,
        price_hc:   parseFloat(newHc) / 100,
        price_hp:   parseFloat(newHp) / 100,
        label:      newLabel,
      })
      setDialogOpen(false)
      setNewFrom(''); setNewHc(''); setNewHp(''); setNewLabel('')
      setSuccess('Période ajoutée. Pensez à recalculer les coûts.')
      loadData()
    } catch (e) {
      setError(e.response?.data?.detail || 'Erreur lors de l\'ajout')
    } finally {
      setAddLoading(false)
    }
  }

  const handleDelete = async (id) => {
    setSuccess(null); setError(null)
    try {
      await deleteTariffPeriod(id)
      setSuccess('Période supprimée.')
      loadData()
    } catch (e) {
      setError(e.response?.data?.detail || 'Erreur lors de la suppression')
    }
  }

  const handleRecalc = async () => {
    setRecalcLoading(true)
    setSuccess(null); setError(null)
    try {
      const result = await recalculateCosts()
      setSuccess(`${result.updated} sessions recalculées (HC/HP + coûts) avec règles et tarifs historiques.`)
    } catch {
      setError('Erreur lors du recalcul')
    } finally {
      setRecalcLoading(false)
    }
  }

  const handleSaveRule = async () => {
    setRuleLoading(true)
    setSuccess(null); setError(null)
    try {
      const saved = await updateTariffRule({
        full_hc_days: editDays,
        hc_windows:   editWindows,
        label:        editLabel,
      })
      setRule(saved)
      setSuccess('Règles HC/HP enregistrées. Pensez à recalculer HC/HP + coûts pour mettre à jour l\'historique.')
    } catch {
      setError('Erreur lors de la sauvegarde des règles')
    } finally {
      setRuleLoading(false)
    }
  }

  const toggleDay = (day) => {
    setEditDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    )
  }

  const addWindow = () => {
    const s = parseTime(newWinStart)
    const e = parseTime(newWinEnd)
    setEditWindows(prev => [...prev, { start_h: s.h, start_m: s.m, end_h: e.h, end_m: e.m }])
  }

  const removeWindow = (idx) => {
    setEditWindows(prev => prev.filter((_, i) => i !== idx))
  }

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}><CircularProgress /></Box>

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} gutterBottom>Paramètres</Typography>

      {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}
      {error   && <Alert severity="error"   sx={{ mb: 2 }}>{error}</Alert>}

      {/* Tarif actif */}
      {config && (
        <Paper sx={{ p: 2.5, borderRadius: 3, mb: 3, maxWidth: { sm: 500 } }}>
          <Typography variant="h6" fontWeight={600} gutterBottom>Tarif actif</Typography>
          <Box sx={{ display: 'flex', gap: 3 }}>
            <Box>
              <Typography variant="caption" color="text.secondary">HC</Typography>
              <Typography variant="h5" fontWeight={700} color="#00b4d8">
                {(config.price_hc * 100).toFixed(2)} <Typography component="span" variant="body2">c€/kWh</Typography>
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">HP</Typography>
              <Typography variant="h5" fontWeight={700} color="#e85d04">
                {(config.price_hp * 100).toFixed(2)} <Typography component="span" variant="body2">c€/kWh</Typography>
              </Typography>
            </Box>
          </Box>
          <Typography variant="caption" color="text.secondary">
            Mis à jour le {new Date(config.updated_at).toLocaleString('fr-FR')}
          </Typography>
        </Paper>
      )}

      {/* Historique des périodes tarifaires */}
      <Paper sx={{ p: 3, borderRadius: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Box>
            <Typography variant="h6" fontWeight={600}>Historique des tarifs EDF</Typography>
            <Typography variant="body2" color="text.secondary">
              Chaque session utilise le tarif de sa période lors du recalcul.
            </Typography>
          </Box>
          <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>
            Ajouter
          </Button>
        </Box>

        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={{ minWidth: 420 }}>
            <TableHead>
              <TableRow>
                <TableCell>En vigueur depuis</TableCell>
                <TableCell>Libellé</TableCell>
                <TableCell align="right">HC (c€/kWh)</TableCell>
                <TableCell align="right">HP (c€/kWh)</TableCell>
                <TableCell align="right"></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {periods.map((p, i) => (
                <TableRow key={p.id} hover>
                  <TableCell>
                    {new Date(p.valid_from).toLocaleDateString('fr-FR')}
                    {i === 0 && <Chip label="actif" color="success" size="small" sx={{ ml: 1 }} />}
                  </TableCell>
                  <TableCell>{p.label || '—'}</TableCell>
                  <TableCell align="right" sx={{ color: '#00b4d8' }}>{(p.price_hc * 100).toFixed(2)}</TableCell>
                  <TableCell align="right" sx={{ color: '#e85d04' }}>{(p.price_hp * 100).toFixed(2)}</TableCell>
                  <TableCell align="right">
                    <IconButton size="small" color="error" onClick={() => handleDelete(p.id)} disabled={periods.length <= 1}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        <Divider sx={{ my: 2 }} />

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Button
            variant="outlined"
            color="warning"
            startIcon={recalcLoading ? <CircularProgress size={16} /> : <RecyclingIcon />}
            onClick={handleRecalc}
            disabled={recalcLoading}
          >
            Recalculer HC/HP + coûts
          </Button>
          <Typography variant="caption" color="text.secondary">
            Recalcule la répartition HC/HP et le coût de chaque session selon les règles et tarifs historiques actifs.
          </Typography>
        </Box>
      </Paper>

      {/* Règles HC/HP — éditables */}
      {rule && (
        <Paper sx={{ p: 3, borderRadius: 3 }}>
          <Typography variant="h6" fontWeight={600} gutterBottom>Règles HC/HP</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Configurez les jours et plages horaires classés Heures Creuses selon votre contrat.
            Après modification, utilisez "Recalculer HC/HP + coûts" pour mettre à jour l'historique.
          </Typography>

          {/* Libellé du contrat */}
          <TextField
            fullWidth size="small" label="Libellé du contrat"
            value={editLabel} onChange={e => setEditLabel(e.target.value)}
            placeholder="Ex: EDF HC/HP + Week-end + Mercredi"
            sx={{ mb: 2.5, maxWidth: { sm: 420 } }}
          />

          {/* Jours entièrement HC */}
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 0.5 }}>
            Jours entièrement en Heures Creuses
          </Typography>
          <FormGroup row sx={{ mb: 2.5 }}>
            {DAY_LABELS.map((label, idx) => (
              <FormControlLabel
                key={idx}
                control={
                  <Checkbox
                    size="small"
                    checked={editDays.includes(idx)}
                    onChange={() => toggleDay(idx)}
                    sx={{ color: '#00b4d8', '&.Mui-checked': { color: '#00b4d8' } }}
                  />
                }
                label={<Typography variant="body2">{label}</Typography>}
              />
            ))}
          </FormGroup>

          {/* Plages horaires HC */}
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
            Plages horaires Heures Creuses <Typography component="span" variant="caption" color="text.secondary">(sur les autres jours)</Typography>
          </Typography>

          {editWindows.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Aucune plage définie — tous les instants seront classés HP.
            </Typography>
          )}

          {editWindows.map((w, idx) => (
            <Box key={idx} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
              <Chip
                label={`${fmtTime(w.start_h, w.start_m)} → ${fmtTime(w.end_h, w.end_m)}`}
                color="info" size="small"
              />
              <IconButton size="small" color="error" onClick={() => removeWindow(idx)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          ))}

          {/* Ajout d'une plage */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1.5, flexWrap: 'wrap' }}>
            <TextField
              size="small" type="time" label="Début HC" value={newWinStart}
              onChange={e => setNewWinStart(e.target.value)}
              InputLabelProps={{ shrink: true }} sx={{ width: 130 }}
            />
            <Typography variant="body2" color="text.secondary">→</Typography>
            <TextField
              size="small" type="time" label="Fin HC" value={newWinEnd}
              onChange={e => setNewWinEnd(e.target.value)}
              InputLabelProps={{ shrink: true }} sx={{ width: 130 }}
            />
            <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={addWindow}>
              Ajouter la plage
            </Button>
          </Box>

          <Divider sx={{ my: 2.5 }} />

          {/* Note Tempo */}
          <Box sx={{ display: 'flex', gap: 1, p: 1.5, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.04)', mb: 2 }}>
            <InfoOutlinedIcon fontSize="small" sx={{ color: 'text.secondary', mt: 0.2, flexShrink: 0 }} />
            <Box>
              <Typography variant="subtitle2" fontWeight={600}>Tarif Tempo EDF — non supporté</Typography>
              <Typography variant="body2" color="text.secondary">
                Le tarif Tempo repose sur une <strong>couleur de jour</strong> (Bleu / Blanc / Rouge) publiée chaque
                soir par RTE pour le lendemain. Chaque couleur a ses propres plages HC/HP et tarifs.
                Intégrer le Tempo nécessiterait d'interroger l'API RTE en temps réel (ou de tenir un
                calendrier des couleurs à jour manuellement), et d'adapter le moteur de calcul pour
                gérer trois niveaux de prix. Cette évolution est identifiée en roadmap mais hors scope
                de la version actuelle.
              </Typography>
            </Box>
          </Box>

          <Button
            variant="contained"
            startIcon={ruleLoading ? <CircularProgress size={16} /> : <SaveIcon />}
            onClick={handleSaveRule}
            disabled={ruleLoading}
          >
            Enregistrer les règles
          </Button>
        </Paper>
      )}

      {/* Dialog ajout période */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Nouvelle période tarifaire</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12}>
              <TextField fullWidth size="small" label="En vigueur depuis" type="date"
                InputLabelProps={{ shrink: true }} value={newFrom}
                onChange={(e) => setNewFrom(e.target.value)} />
            </Grid>
            <Grid item xs={6}>
              <TextField fullWidth size="small" label="HC (c€/kWh)" type="number"
                inputProps={{ step: '0.01' }} value={newHc}
                onChange={(e) => setNewHc(e.target.value)} helperText="Ex: 17.24" />
            </Grid>
            <Grid item xs={6}>
              <TextField fullWidth size="small" label="HP (c€/kWh)" type="number"
                inputProps={{ step: '0.01' }} value={newHp}
                onChange={(e) => setNewHp(e.target.value)} helperText="Ex: 23.05" />
            </Grid>
            <Grid item xs={12}>
              <TextField fullWidth size="small" label="Libellé (optionnel)" value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)} placeholder="Ex: Révision août 2026" />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Annuler</Button>
          <Button variant="contained" onClick={handleAdd} disabled={addLoading || !newFrom || !newHc || !newHp}>
            {addLoading ? <CircularProgress size={16} /> : 'Ajouter'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
