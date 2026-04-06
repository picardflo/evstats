/**
 * Page Véhicule — gestion des véhicules électriques et statistiques au km.
 *
 * Fonctionnalités :
 *  - Ajout / édition / suppression d'un véhicule (nom, année, batterie, conso)
 *  - Upload d'une photo (JPEG/PNG/WebP, stockée côté serveur)
 *  - KPIs calculés à partir de toutes les sessions :
 *      · km rechargés  = énergie × 1000 / consommation_wh_per_km
 *      · coût / 100km  = coût_total / km × 100
 *      · éco / 100km   = économies / km × 100
 *      · nb "pleins"   = énergie_totale / batterie_nette
 */
import React, { useState, useEffect, useCallback } from 'react'
import {
  Box, Typography, Paper, Grid, Button, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, CircularProgress, Alert, IconButton, Chip,
} from '@mui/material'
import DirectionsCarIcon from '@mui/icons-material/DirectionsCar'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera'
import {
  fetchVehicles, createVehicle, updateVehicle, deleteVehicle,
  uploadVehicleImage, vehicleImageUrl,
} from '../api/client'
import { fetchMonthlyStats } from '../api/client'

const COLORS = { cost: '#06d6a0', savings: '#a855f7', energy: '#ffd60a', hc: '#00b4d8' }

function KpiCard({ label, value, unit, color = 'text.primary', sub }) {
  return (
    <Paper sx={{ p: 2.5, borderRadius: 3 }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5, mt: 0.5, flexWrap: 'wrap' }}>
        <Typography variant="h4" fontWeight={700} color={color}>
          {value}
          <Typography component="span" variant="body1" color="text.secondary" sx={{ ml: 0.5 }}>{unit}</Typography>
        </Typography>
      </Box>
      {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
    </Paper>
  )
}

const EMPTY_FORM = { name: '', year: '', battery_kwh: '', consumption_wh_per_km: '' }

export default function Vehicle() {
  const [vehicles, setVehicles]     = useState([])
  const [monthly, setMonthly]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)
  const [success, setSuccess]       = useState(null)

  // Dialog création / édition
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing]       = useState(null)   // Vehicle en cours d'édition (null = création)
  const [form, setForm]             = useState(EMPTY_FORM)
  const [saving, setSaving]         = useState(false)

  // Upload image
  const [imgLoading, setImgLoading] = useState(null)   // id du véhicule en cours d'upload
  // Clé pour forcer le rechargement de l'image après upload
  const [imgKeys, setImgKeys]       = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [v, m] = await Promise.all([fetchVehicles(), fetchMonthlyStats()])
      setVehicles(v)
      setMonthly(m)
    } catch {
      setError('Impossible de charger les données')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Totaux globaux calculés à partir des stats mensuelles
  const totals = monthly.reduce(
    (acc, d) => ({
      energy_kwh:  acc.energy_kwh  + d.energy_kwh,
      cost_eur:    acc.cost_eur    + d.cost_eur,
      savings_eur: acc.savings_eur + (d.savings_eur || 0),
      sessions:    acc.sessions    + d.sessions,
    }),
    { energy_kwh: 0, cost_eur: 0, savings_eur: 0, sessions: 0 }
  )

  // Calculs au km pour un véhicule donné
  function computeKmStats(v) {
    const km = totals.energy_kwh * 1000 / v.consumption_wh_per_km
    const costPer100 = km > 0 ? (totals.cost_eur / km * 100) : 0
    const savingsPer100 = km > 0 ? (totals.savings_eur / km * 100) : 0
    const fullCharges = v.battery_kwh > 0 ? totals.energy_kwh / v.battery_kwh : 0
    return { km, costPer100, savingsPer100, fullCharges }
  }

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  const openEdit = (v) => {
    setEditing(v)
    setForm({
      name: v.name,
      year: v.year ?? '',
      battery_kwh: String(v.battery_kwh),
      consumption_wh_per_km: String(v.consumption_wh_per_km),
    })
    setDialogOpen(true)
  }

  const handleSave = async () => {
    setSaving(true); setSuccess(null); setError(null)
    try {
      const payload = {
        name: form.name,
        year: form.year ? parseInt(form.year) : null,
        battery_kwh: parseFloat(form.battery_kwh),
        consumption_wh_per_km: parseFloat(form.consumption_wh_per_km),
      }
      if (editing) {
        await updateVehicle(editing.id, payload)
        setSuccess('Véhicule mis à jour.')
      } else {
        await createVehicle(payload)
        setSuccess('Véhicule ajouté.')
      }
      setDialogOpen(false)
      load()
    } catch (e) {
      setError(e.response?.data?.detail || 'Erreur lors de la sauvegarde')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    setSuccess(null); setError(null)
    try {
      await deleteVehicle(id)
      setSuccess('Véhicule supprimé.')
      load()
    } catch {
      setError('Erreur lors de la suppression')
    }
  }

  const handleImageUpload = async (vehicleId, file) => {
    if (!file) return
    setImgLoading(vehicleId)
    setSuccess(null); setError(null)
    try {
      await uploadVehicleImage(vehicleId, file)
      // Recharge les véhicules (met à jour image_filename) + force cache-bust de l'img
      await load()
      setImgKeys((prev) => ({ ...prev, [vehicleId]: Date.now() }))
      setSuccess('Photo mise à jour.')
    } catch (e) {
      setError(e.response?.data?.detail || 'Erreur lors de l\'upload')
    } finally {
      setImgLoading(null)
    }
  }

  const formValid = form.name && form.battery_kwh && form.consumption_wh_per_km

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}><CircularProgress /></Box>

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h5" fontWeight={700}>Véhicule</Typography>
        <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={openCreate}>
          Ajouter un véhicule
        </Button>
      </Box>

      {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}
      {error   && <Alert severity="error"   sx={{ mb: 2 }}>{error}</Alert>}

      {vehicles.length === 0 ? (
        <Paper sx={{ p: 6, borderRadius: 3, textAlign: 'center' }}>
          <DirectionsCarIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>Aucun véhicule</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Ajoutez votre véhicule pour obtenir les statistiques au kilomètre.
          </Typography>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
            Ajouter un véhicule
          </Button>
        </Paper>
      ) : (
        vehicles.map((v) => {
          const { km, costPer100, savingsPer100, fullCharges } = computeKmStats(v)
          const imgKey = imgKeys[v.id] || 0

          return (
            <Box key={v.id} sx={{ mb: 4 }}>
              {/* Carte véhicule */}
              <Paper sx={{ p: 3, borderRadius: 3, mb: 3 }}>
                <Grid container spacing={3} alignItems="center">
                  {/* Photo */}
                  <Grid item xs={12} sm="auto">
                    <Box sx={{ position: 'relative', width: { xs: '100%', sm: 200 }, mx: { xs: 'auto', sm: 0 } }}>
                      <Box sx={{
                          width: '100%', height: 130, borderRadius: 2, overflow: 'hidden',
                          bgcolor: 'rgba(255,255,255,0.06)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        {v.image_filename
                          ? <Box component="img"
                              src={`${vehicleImageUrl(v.id)}?k=${imgKey}`}
                              alt={v.name}
                              sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                          : <DirectionsCarIcon sx={{ fontSize: 64, color: 'rgba(255,255,255,0.2)' }} />
                        }
                      </Box>

                      {/* Bouton upload photo */}
                      <Box sx={{ position: 'absolute', bottom: 6, right: 6 }}>
                        <input
                          id={`img-input-${v.id}`}
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          hidden
                          onChange={(e) => handleImageUpload(v.id, e.target.files[0])}
                        />
                        <IconButton
                          size="small"
                          onClick={() => document.getElementById(`img-input-${v.id}`).click()}
                          disabled={imgLoading === v.id}
                          sx={{ bgcolor: 'rgba(0,0,0,0.6)', '&:hover': { bgcolor: 'rgba(0,0,0,0.8)' } }}
                        >
                          {imgLoading === v.id
                            ? <CircularProgress size={16} />
                            : <PhotoCameraIcon fontSize="small" />
                          }
                        </IconButton>
                      </Box>
                    </Box>
                  </Grid>

                  {/* Infos */}
                  <Grid item xs={12} sm>
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
                      <Box>
                        <Typography variant="h5" fontWeight={700}>{v.name}</Typography>
                        {v.year && (
                          <Chip label={v.year} size="small" sx={{ mt: 0.5 }} />
                        )}
                        <Box sx={{ mt: 1.5, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                          <Box>
                            <Typography variant="caption" color="text.secondary">Batterie nette</Typography>
                            <Typography fontWeight={600} color={COLORS.energy}>{v.battery_kwh} kWh</Typography>
                          </Box>
                          <Box>
                            <Typography variant="caption" color="text.secondary">Conso réelle</Typography>
                            <Typography fontWeight={600} color={COLORS.hc}>{v.consumption_wh_per_km} Wh/km</Typography>
                          </Box>
                          <Box>
                            <Typography variant="caption" color="text.secondary">Autonomie théorique</Typography>
                            <Typography fontWeight={600}>
                              ~{Math.round(v.battery_kwh * 1000 / v.consumption_wh_per_km)} km
                            </Typography>
                          </Box>
                        </Box>
                      </Box>
                      <Box sx={{ display: 'flex', gap: 1 }}>
                        <IconButton size="small" onClick={() => openEdit(v)} sx={{ color: 'text.secondary' }}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                        <IconButton size="small" color="error" onClick={() => handleDelete(v.id)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    </Box>
                  </Grid>
                </Grid>
              </Paper>

              {/* KPIs au kilomètre */}
              <Grid container spacing={2}>
                <Grid item xs={6} sm={3}>
                  <KpiCard
                    label="Km rechargés"
                    value={Math.round(km).toLocaleString('fr-FR')}
                    unit="km"
                    color="text.primary"
                    sub={`sur ${totals.sessions} sessions`}
                  />
                </Grid>
                <Grid item xs={6} sm={3}>
                  <KpiCard
                    label="Coût / 100 km"
                    value={costPer100.toFixed(2)}
                    unit="€"
                    color={COLORS.cost}
                    sub={`total : ${totals.cost_eur.toFixed(2)} €`}
                  />
                </Grid>
                <Grid item xs={6} sm={3}>
                  <KpiCard
                    label="Économies / 100 km"
                    value={savingsPer100.toFixed(2)}
                    unit="€"
                    color={COLORS.savings}
                    sub="vs 100% HP"
                  />
                </Grid>
                <Grid item xs={6} sm={3}>
                  <KpiCard
                    label="Pleins équivalents"
                    value={fullCharges.toFixed(1)}
                    unit=""
                    color={COLORS.hc}
                    sub={`batterie de ${v.battery_kwh} kWh`}
                  />
                </Grid>
              </Grid>
            </Box>
          )
        })
      )}

      {/* Dialog ajout / édition */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{editing ? 'Modifier le véhicule' : 'Nouveau véhicule'}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth size="small" label="Nom du véhicule"
                value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ex : Nissan LEAF 40 kWh"
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth size="small" label="Année" type="number"
                value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })}
                placeholder="Ex : 2018" inputProps={{ min: 2000, max: 2100 }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth size="small" label="Batterie nette (kWh)" type="number"
                value={form.battery_kwh} onChange={(e) => setForm({ ...form, battery_kwh: e.target.value })}
                inputProps={{ step: '0.1', min: 1 }}
                helperText="Capacité utilisable. Ex: LEAF 40kWh → 36"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth size="small" label="Conso réelle (Wh/km)" type="number"
                value={form.consumption_wh_per_km} onChange={(e) => setForm({ ...form, consumption_wh_per_km: e.target.value })}
                inputProps={{ step: '1', min: 50 }}
                helperText="Conso réelle. Ex: LEAF ≈ 160"
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Annuler</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving || !formValid}>
            {saving ? <CircularProgress size={16} /> : (editing ? 'Enregistrer' : 'Ajouter')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
