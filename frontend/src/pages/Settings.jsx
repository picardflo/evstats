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
  DialogActions,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import RecyclingIcon from '@mui/icons-material/Recycling'
import {
  fetchTariffConfig, fetchTariffPeriods, addTariffPeriod,
  deleteTariffPeriod, recalculateCosts,
} from '../api/client'

export default function Settings() {
  const [config, setConfig]         = useState(null)
  const [periods, setPeriods]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [recalcLoading, setRecalcLoading] = useState(false)
  const [success, setSuccess]       = useState(null)
  const [error, setError]           = useState(null)

  // Formulaire nouvelle période
  const [dialogOpen, setDialogOpen] = useState(false)
  const [newFrom, setNewFrom]       = useState('')
  const [newHc, setNewHc]           = useState('')
  const [newHp, setNewHp]           = useState('')
  const [newLabel, setNewLabel]     = useState('')
  const [addLoading, setAddLoading] = useState(false)

  const loadData = useCallback(async () => {
    try {
      const [cfg, ps] = await Promise.all([fetchTariffConfig(), fetchTariffPeriods()])
      setConfig(cfg)
      setPeriods(ps)
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
      setSuccess(`${result.updated} sessions recalculées avec les tarifs historiques par période.`)
    } catch {
      setError('Erreur lors du recalcul')
    } finally {
      setRecalcLoading(false)
    }
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
            Recalculer tous les coûts
          </Button>
          <Typography variant="caption" color="text.secondary">
            Applique le bon tarif historique à chaque session selon sa date.
          </Typography>
        </Box>
      </Paper>

      {/* Règles tarifaires */}
      <Paper sx={{ p: 3, borderRadius: 3, maxWidth: { sm: 500 } }}>
        <Typography variant="h6" fontWeight={600} gutterBottom>Règles HC/HP (non modifiables)</Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
          <Chip label="Mercredi → 100% HC"           color="info"    size="small" />
          <Chip label="Week-end → 100% HC"            color="info"    size="small" />
          <Chip label="Lun/Mar/Jeu/Ven HC : 23h30→07h30" color="default" size="small" />
          <Chip label="Lun/Mar/Jeu/Ven HP : 07h30→23h30" color="warning" size="small" />
        </Box>
      </Paper>

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
