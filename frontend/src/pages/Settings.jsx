/**
 * Page Paramètres — configuration des tarifs EDF.
 *
 * Les tarifs EDF changent typiquement 2× par an (février et août).
 * Cette page permet de les mettre à jour sans redéploiement.
 *
 * Workflow utilisateur :
 *  1. Modifier HC et/ou HP (en c€/kWh, l'UI divise par 100 avant l'envoi)
 *  2. "Enregistrer" → met à jour TariffConfig en base (prix futurs)
 *  3. "Recalculer tous les coûts" → applique les nouveaux tarifs à
 *     toutes les sessions existantes (coût €, pas la répartition HC/HP)
 *
 * Note V2 : le recalcul est global (pas de filtre par date).
 * Pour un recalcul partiel (ex: appliquer le nouveau tarif seulement
 * aux sessions après le 01/08), il faudra implémenter l'historique
 * des périodes tarifaires.
 */
import React, { useState, useEffect } from 'react'
import {
  Box, Typography, Paper, TextField, Button, Alert, CircularProgress,
  Divider, Grid, Chip,
} from '@mui/material'
import SaveIcon from '@mui/icons-material/Save'
import RecyclingIcon from '@mui/icons-material/Recycling'
import { fetchTariffConfig, updateTariffConfig, recalculateCosts } from '../api/client'

export default function Settings() {
  const [config, setConfig] = useState(null)
  const [priceHc, setPriceHc] = useState('')
  const [priceHp, setPriceHp] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [recalcLoading, setRecalcLoading] = useState(false)
  const [success, setSuccess] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchTariffConfig()
      .then((d) => {
        setConfig(d)
        setPriceHc((d.price_hc * 100).toFixed(2))
        setPriceHp((d.price_hp * 100).toFixed(2))
      })
      .catch(() => setError('Impossible de charger la configuration'))
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setSuccess(null)
    setError(null)
    try {
      const updated = await updateTariffConfig({
        price_hc: parseFloat(priceHc) / 100,
        price_hp: parseFloat(priceHp) / 100,
      })
      setConfig(updated)
      setSuccess('Tarifs mis à jour. Pensez à recalculer les coûts si vous voulez les appliquer aux sessions existantes.')
    } catch {
      setError('Erreur lors de la sauvegarde')
    } finally {
      setSaving(false)
    }
  }

  const handleRecalc = async () => {
    setRecalcLoading(true)
    setSuccess(null)
    setError(null)
    try {
      const result = await recalculateCosts()
      setSuccess(`${result.updated} sessions recalculées avec HC=${(result.price_hc * 100).toFixed(2)} c€/kWh et HP=${(result.price_hp * 100).toFixed(2)} c€/kWh`)
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

      <Paper sx={{ p: 3, borderRadius: 3, maxWidth: 500 }}>
        <Typography variant="h6" fontWeight={600} gutterBottom>Tarifs EDF</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Option HC + Week-end + Mercredi · 12 kVA
        </Typography>

        {config && (
          <Typography variant="caption" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
            Dernière mise à jour : {new Date(config.updated_at).toLocaleString('fr-FR')}
          </Typography>
        )}

        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={6}>
            <TextField
              fullWidth
              label="Prix HC (c€/kWh)"
              value={priceHc}
              onChange={(e) => setPriceHc(e.target.value)}
              type="number"
              inputProps={{ step: '0.01', min: '0' }}
              helperText="Ex: 17.24"
            />
          </Grid>
          <Grid item xs={6}>
            <TextField
              fullWidth
              label="Prix HP (c€/kWh)"
              value={priceHp}
              onChange={(e) => setPriceHp(e.target.value)}
              type="number"
              inputProps={{ step: '0.01', min: '0' }}
              helperText="Ex: 23.05"
            />
          </Grid>
        </Grid>

        <Button
          variant="contained"
          startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}
          onClick={handleSave}
          disabled={saving}
          sx={{ mr: 2 }}
        >
          Enregistrer
        </Button>

        <Divider sx={{ my: 3 }} />

        <Typography variant="subtitle1" fontWeight={600} gutterBottom>Recalcul des coûts</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Applique les tarifs actuels à toutes les sessions existantes en base.
          La répartition HC/HP (kWh) reste inchangée, seul le coût € est recalculé.
        </Typography>

        <Button
          variant="outlined"
          color="warning"
          startIcon={recalcLoading ? <CircularProgress size={16} /> : <RecyclingIcon />}
          onClick={handleRecalc}
          disabled={recalcLoading}
        >
          Recalculer tous les coûts
        </Button>

        {success && <Alert severity="success" sx={{ mt: 2 }}>{success}</Alert>}
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </Paper>

      <Paper sx={{ p: 3, borderRadius: 3, maxWidth: 500, mt: 3 }}>
        <Typography variant="h6" fontWeight={600} gutterBottom>Règles tarifaires (non modifiables)</Typography>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          Ces règles sont fixes et correspondent au contrat EDF actuel.
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1.5 }}>
          <Chip label="Mercredi → 100% HC" color="info" size="small" />
          <Chip label="Week-end → 100% HC" color="info" size="small" />
          <Chip label="Lun/Mar/Jeu/Ven HC : 23h30 → 07h30" color="default" size="small" />
          <Chip label="Lun/Mar/Jeu/Ven HP : 07h30 → 23h30" color="warning" size="small" />
        </Box>
      </Paper>
    </Box>
  )
}
