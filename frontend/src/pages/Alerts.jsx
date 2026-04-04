/**
 * Page Alertes — configuration des seuils de consommation mensuelle.
 *
 * Une alerte est envoyée via webhook HTTP POST quand la consommation
 * du mois en cours dépasse le seuil kWh ou € configuré.
 *
 * Compatible avec :
 *   - ntfy.sh (self-hosted ou public) : https://ntfy.sh/mon-topic
 *   - Slack : https://hooks.slack.com/services/...
 *   - Discord : https://discord.com/api/webhooks/...
 *   - Tout service acceptant un POST JSON { title, message, priority }
 *
 * Le bouton "Tester maintenant" appelle POST /api/alerts/check manuellement.
 * En production, l'appel est automatiquement fait au chargement du Dashboard.
 */
import React, { useState, useEffect } from 'react'
import {
  Box, Typography, Paper, TextField, Button, Alert, CircularProgress,
  Switch, FormControlLabel, Grid, Divider, Chip,
} from '@mui/material'
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive'
import SendIcon from '@mui/icons-material/Send'
import { fetchAlertConfig, updateAlertConfig, checkAlerts } from '../api/client'

export default function Alerts() {
  const [config, setConfig]         = useState(null)
  const [enabled, setEnabled]       = useState(false)
  const [threshKwh, setThreshKwh]   = useState('')
  const [threshEur, setThreshEur]   = useState('')
  const [webhookUrl, setWebhookUrl] = useState('')
  const [loading, setLoading]       = useState(true)
  const [saving, setSaving]         = useState(false)
  const [checking, setChecking]     = useState(false)
  const [success, setSuccess]       = useState(null)
  const [error, setError]           = useState(null)

  useEffect(() => {
    fetchAlertConfig()
      .then((d) => {
        setConfig(d)
        setEnabled(d.enabled)
        setThreshKwh(d.threshold_kwh > 0 ? String(d.threshold_kwh) : '')
        setThreshEur(d.threshold_eur > 0 ? String(d.threshold_eur) : '')
        setWebhookUrl(d.webhook_url || '')
      })
      .catch(() => setError('Impossible de charger la configuration'))
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    setSaving(true); setSuccess(null); setError(null)
    try {
      const updated = await updateAlertConfig({
        enabled,
        threshold_kwh: parseFloat(threshKwh) || 0,
        threshold_eur: parseFloat(threshEur) || 0,
        webhook_url:   webhookUrl,
      })
      setConfig(updated)
      setSuccess('Configuration sauvegardée.')
    } catch {
      setError('Erreur lors de la sauvegarde')
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

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}><CircularProgress /></Box>

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} gutterBottom>Alertes</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Recevez une notification quand votre consommation mensuelle dépasse un seuil.
      </Typography>

      {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}
      {error   && <Alert severity="error"   sx={{ mb: 2 }}>{error}</Alert>}

      <Paper sx={{ p: 3, borderRadius: 3, maxWidth: 560 }}>
        <FormControlLabel
          control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} color="primary" />}
          label={<Typography fontWeight={600}>Alertes activées</Typography>}
          sx={{ mb: 2 }}
        />

        <Grid container spacing={2}>
          <Grid item xs={6}>
            <TextField
              fullWidth size="small" label="Seuil kWh / mois" type="number"
              value={threshKwh} onChange={(e) => setThreshKwh(e.target.value)}
              disabled={!enabled} helperText="0 = désactivé"
              inputProps={{ min: 0, step: 10 }}
            />
          </Grid>
          <Grid item xs={6}>
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
            variant="contained"
            startIcon={saving ? <CircularProgress size={16} /> : <NotificationsActiveIcon />}
            onClick={handleSave}
            disabled={saving}
          >
            Enregistrer
          </Button>
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
      </Paper>

      {/* Info compatibilité */}
      <Paper sx={{ p: 3, borderRadius: 3, maxWidth: 560, mt: 3 }}>
        <Typography variant="h6" fontWeight={600} gutterBottom>Format du webhook</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Le backend envoie un POST JSON avec ce payload :
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
    </Box>
  )
}
