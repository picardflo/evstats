/**
 * Page Alertes — seuils de consommation mensuelle et notifications Awtrix NG.
 *
 * Deux sections :
 *   1. Webhook générique — alerte mensuelle si seuil kWh ou € dépassé (ntfy, Slack, Discord…)
 *   2. Horloges Awtrix NG — notifications temps réel : début / suivi / fin de charge
 *
 * Depuis la v1.9.0, plusieurs horloges peuvent être enregistrées, et chacune
 * choisit les notifications qu'elle reçoit : on peut vouloir le suivi permanent
 * sur l'horloge du bureau et seulement début/fin au salon.
 *
 * Le bouton "Tester maintenant" (webhook) appelle POST /api/alerts/check.
 * Le bouton "Tester" d'une horloge envoie une notification sans sauvegarder,
 * en utilisant l'URL saisie dans le champ.
 */
import React, { useState, useEffect } from 'react'
import {
  Box, Typography, Paper, TextField, Button, Alert, CircularProgress,
  Switch, FormControlLabel, Grid, Divider, Chip, Checkbox, IconButton, Tooltip,
} from '@mui/material'
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive'
import SendIcon from '@mui/icons-material/Send'
import WifiIcon from '@mui/icons-material/Wifi'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import {
  fetchAlertConfig, updateAlertConfig, checkAlerts, testAwtrix,
  fetchAwtrixClocks, createAwtrixClock, updateAwtrixClock, deleteAwtrixClock,
} from '../api/client'

const BLANK_CLOCK = {
  id: null, name: '', url: '',
  enabled: true, notify_start: true, notify_update: true, notify_end: true,
}

export default function Alerts() {
  // ── Webhook état ─────────────────────────────────────────────────────────────
  const [config, setConfig]         = useState(null)
  const [enabled, setEnabled]       = useState(false)
  const [threshKwh, setThreshKwh]   = useState('')
  const [threshEur, setThreshEur]   = useState('')
  const [webhookUrl, setWebhookUrl] = useState('')

  // ── Awtrix état ──────────────────────────────────────────────────────────────
  const [clocks, setClocks]         = useState([])
  const [awtrixInterval, setAwtrixInterval] = useState('30')

  // ── UI état ──────────────────────────────────────────────────────────────────
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [checking, setChecking] = useState(false)
  const [testing,  setTesting]  = useState(null)   // index de l'horloge en cours de test
  const [success,  setSuccess]  = useState(null)
  const [error,    setError]    = useState(null)

  useEffect(() => {
    Promise.all([fetchAlertConfig(), fetchAwtrixClocks()])
      .then(([d, list]) => {
        setConfig(d)
        setEnabled(d.enabled)
        setThreshKwh(d.threshold_kwh > 0 ? String(d.threshold_kwh) : '')
        setThreshEur(d.threshold_eur > 0 ? String(d.threshold_eur) : '')
        setWebhookUrl(d.webhook_url || '')
        setAwtrixInterval(String(d.awtrix_update_interval_min ?? 30))
        setClocks(list)
      })
      .catch(() => setError('Impossible de charger la configuration'))
      .finally(() => setLoading(false))
  }, [])

  const patchClock = (index, patch) =>
    setClocks((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)))

  const handleAddClock = () => setClocks((prev) => [...prev, { ...BLANK_CLOCK }])

  const handleDeleteClock = async (index) => {
    const clock = clocks[index]
    // Une horloge jamais enregistrée n'existe qu'ici : pas d'appel API.
    if (clock.id == null) {
      setClocks((prev) => prev.filter((_, i) => i !== index))
      return
    }
    setSuccess(null); setError(null)
    try {
      await deleteAwtrixClock(clock.id)
      setClocks((prev) => prev.filter((_, i) => i !== index))
      setSuccess(`Horloge « ${clock.name || clock.url} » supprimée.`)
    } catch (e) {
      setError(e.response?.data?.detail || 'Suppression impossible')
    }
  }

  const handleSave = async () => {
    setSaving(true); setSuccess(null); setError(null)
    try {
      const updated = await updateAlertConfig({
        enabled,
        threshold_kwh:              parseFloat(threshKwh) || 0,
        threshold_eur:              parseFloat(threshEur) || 0,
        webhook_url:                webhookUrl,
        awtrix_update_interval_min: parseInt(awtrixInterval) || 30,
      })
      setConfig(updated)

      // Les horloges sans URL sont ignorées plutôt que refusées : une ligne
      // ajoutée puis laissée vide ne doit pas bloquer l'enregistrement du reste.
      for (const clock of clocks) {
        if (!clock.url.trim()) continue
        const payload = {
          name: clock.name, url: clock.url.trim(), enabled: clock.enabled,
          notify_start: clock.notify_start,
          notify_update: clock.notify_update,
          notify_end: clock.notify_end,
        }
        if (clock.id == null) await createAwtrixClock(payload)
        else                  await updateAwtrixClock(clock.id, payload)
      }
      setClocks(await fetchAwtrixClocks())
      setSuccess('Configuration sauvegardée.')
    } catch (e) {
      setError(e.response?.data?.detail || 'Erreur lors de la sauvegarde')
    } finally {
      setSaving(false)
    }
  }

  const handleCheck = async () => {
    setChecking(true); setSuccess(null); setError(null)
    try {
      const result = await checkAlerts()
      if (result.sent) {
        setSuccess(`Alerte envoyée : ${result.message}`)
      } else {
        setSuccess(`Aucune alerte envoyée — ${result.reason}${result.total_kwh !== undefined ? ` (${result.total_kwh?.toFixed(1)} kWh / ${result.total_eur?.toFixed(2)} € ce mois)` : ''}`)
      }
    } catch (e) {
      setError(e.response?.data?.detail || 'Erreur lors de la vérification')
    } finally {
      setChecking(false)
    }
  }

  const handleTestClock = async (index) => {
    setTesting(index); setSuccess(null); setError(null)
    try {
      const r = await testAwtrix(clocks[index].url)
      setSuccess(`Notification de test envoyée${r?.detail ? ` — ${r.detail}` : ''}.`)
    } catch (e) {
      setError(e.response?.data?.detail || "Impossible de joindre l'horloge")
    } finally {
      setTesting(null)
    }
  }

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}><CircularProgress /></Box>

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} gutterBottom>Alertes</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Notifications de consommation mensuelle et événements de charge en temps réel.
      </Typography>

      {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}
      {error   && <Alert severity="error"   sx={{ mb: 2 }}>{error}</Alert>}

      {/* ── Section 1 : Webhook mensuel ─────────────────────────────────────── */}
      <Paper sx={{ p: 3, borderRadius: 3, maxWidth: 680 }}>
        <Typography variant="h6" fontWeight={600} gutterBottom>Seuils mensuels</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Recevez une notification si la consommation du mois dépasse un seuil.
        </Typography>

        <FormControlLabel
          control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} color="primary" />}
          label={<Typography fontWeight={600}>Alertes activées</Typography>}
          sx={{ mb: 2 }}
        />

        <Grid container spacing={2}>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth size="small" label="Seuil kWh / mois" type="number"
              value={threshKwh} onChange={(e) => setThreshKwh(e.target.value)}
              disabled={!enabled} helperText="0 = désactivé"
              inputProps={{ min: 0, step: 10 }}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth size="small" label="Seuil € / mois" type="number"
              value={threshEur} onChange={(e) => setThreshEur(e.target.value)}
              disabled={!enabled} helperText="0 = désactivé"
              inputProps={{ min: 0, step: 5 }}
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              fullWidth size="small" label="URL Webhook" value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)} disabled={!enabled}
              placeholder="https://ntfy.sh/mon-topic"
              helperText="Compatible ntfy, Slack, Discord (POST JSON)"
            />
          </Grid>
        </Grid>

        <Box sx={{ display: 'flex', gap: 2, mt: 3 }}>
          <Button
            variant="outlined"
            startIcon={checking ? <CircularProgress size={16} /> : <SendIcon />}
            onClick={handleCheck}
            disabled={checking}
          >
            Tester maintenant
          </Button>
        </Box>

        {config?.last_alert_month && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="body2" color="text.secondary">
              Dernière alerte envoyée : <strong>{config.last_alert_month}</strong>
            </Typography>
          </>
        )}

        <Divider sx={{ my: 2 }} />
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Payload envoyé :
        </Typography>
        <Box component="pre" sx={{
          bgcolor: 'rgba(0,0,0,0.3)', p: 1.5, borderRadius: 2,
          fontSize: 12, color: '#c9d1d9', overflowX: 'auto',
        }}>
{`{
  "title": "🔋 EVSE Stats — Alerte 2026-04",
  "message": "⚡ 312.4 kWh (seuil: 300 kWh)",
  "priority": "high"
}`}
        </Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 2 }}>
          <Chip label="ntfy.sh" color="success" size="small" />
          <Chip label="Slack" color="info" size="small" />
          <Chip label="Discord" size="small" />
          <Chip label="Tout service POST JSON" size="small" variant="outlined" />
        </Box>
      </Paper>

      {/* ── Section 2 : Horloges Awtrix NG ──────────────────────────────────── */}
      <Paper sx={{ p: 3, borderRadius: 3, maxWidth: 680, mt: 3 }}>
        <Typography variant="h6" fontWeight={600} gutterBottom>Horloges Awtrix NG</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Notifie vos horloges LED à chaque événement de charge. Chaque horloge
          choisit les notifications qu'elle reçoit. Firmware AWTRIX NG requis —
          l'API d'AWTRIX 3 n'est plus compatible.
        </Typography>

        <Grid container spacing={2} sx={{ mb: 1 }}>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth size="small" label="Intervalle de suivi (min)" type="number"
              value={awtrixInterval} onChange={(e) => setAwtrixInterval(e.target.value)}
              helperText="Commun à toutes les horloges"
              inputProps={{ min: 5, max: 120, step: 5 }}
            />
          </Grid>
        </Grid>

        {clocks.length === 0 && (
          <Alert severity="info" sx={{ my: 2 }}>
            Aucune horloge enregistrée. Ajoutez-en une pour recevoir les notifications de charge.
          </Alert>
        )}

        {clocks.map((clock, i) => (
          <Box key={clock.id ?? `new-${i}`} sx={{
            border: '1px solid', borderColor: 'divider', borderRadius: 2,
            p: 2, mt: 2, opacity: clock.enabled ? 1 : 0.6,
          }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={clock.enabled}
                    onChange={(e) => patchClock(i, { enabled: e.target.checked })}
                    color="primary"
                  />
                }
                label={<Typography fontWeight={600}>{clock.name || 'Horloge sans nom'}</Typography>}
              />
              <Tooltip title="Supprimer cette horloge">
                <IconButton color="error" size="small" onClick={() => handleDeleteClock(i)}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>

            <Grid container spacing={2}>
              <Grid item xs={12} sm={5}>
                <TextField
                  fullWidth size="small" label="Nom" value={clock.name}
                  onChange={(e) => patchClock(i, { name: e.target.value })}
                  placeholder="Salon"
                />
              </Grid>
              <Grid item xs={12} sm={7}>
                <TextField
                  fullWidth size="small" label="URL" value={clock.url}
                  onChange={(e) => patchClock(i, { url: e.target.value })}
                  placeholder="http://awtrix-cl1.home.lan"
                />
              </Grid>
            </Grid>

            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5, mt: 1 }}>
              <FormControlLabel
                control={<Checkbox size="small" checked={clock.notify_start}
                  onChange={(e) => patchClock(i, { notify_start: e.target.checked })} />}
                label={<Typography variant="body2">Début</Typography>}
              />
              <FormControlLabel
                control={<Checkbox size="small" checked={clock.notify_update}
                  onChange={(e) => patchClock(i, { notify_update: e.target.checked })} />}
                label={<Typography variant="body2">Suivi en cours</Typography>}
              />
              <FormControlLabel
                control={<Checkbox size="small" checked={clock.notify_end}
                  onChange={(e) => patchClock(i, { notify_end: e.target.checked })} />}
                label={<Typography variant="body2">Fin</Typography>}
              />
              <Box sx={{ flexGrow: 1 }} />
              <Button
                size="small" variant="outlined"
                startIcon={testing === i ? <CircularProgress size={14} /> : <WifiIcon />}
                onClick={() => handleTestClock(i)}
                disabled={!clock.url || testing !== null}
              >
                Tester
              </Button>
            </Box>
          </Box>
        ))}

        <Button startIcon={<AddIcon />} onClick={handleAddClock} sx={{ mt: 2 }}>
          Ajouter une horloge
        </Button>

        <Divider sx={{ my: 2 }} />
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Trois notifications automatiques lors des charges :
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          <Chip label="Début — éphémère 10 s" color="success" size="small" />
          <Chip label={`Suivi — app persistante toutes les ${awtrixInterval} min`} color="info" size="small" />
          <Chip label="Fin — éphémère 30 s" color="warning" size="small" />
        </Box>
      </Paper>

      {/* ── Bouton Enregistrer global ─────────────────────────────────────────── */}
      <Box sx={{ mt: 3, maxWidth: 680 }}>
        <Button
          variant="contained"
          startIcon={saving ? <CircularProgress size={16} /> : <NotificationsActiveIcon />}
          onClick={handleSave}
          disabled={saving}
        >
          Enregistrer
        </Button>
      </Box>
    </Box>
  )
}
