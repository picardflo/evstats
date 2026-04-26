/**
 * Page Alertes — configuration des seuils de consommation mensuelle et des notifications Awtrix3.
 *
 * Deux sections :
 *   1. Webhook générique — alerte mensuelle si seuil kWh ou € dépassé (ntfy, Slack, Discord…)
 *   2. Horloge Awtrix3  — notifications temps réel : début / mise à jour / fin de charge
 *
 * Le bouton "Tester maintenant" (webhook) appelle POST /api/alerts/check manuellement.
 * Le bouton "Tester" (Awtrix) envoie une notification de test à l'horloge.
 */
import React, { useState, useEffect } from 'react'
import {
  Box, Typography, Paper, TextField, Button, Alert, CircularProgress,
  Switch, FormControlLabel, Grid, Divider, Chip,
} from '@mui/material'
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive'
import SendIcon from '@mui/icons-material/Send'
import WifiIcon from '@mui/icons-material/Wifi'
import { fetchAlertConfig, updateAlertConfig, checkAlerts, testAwtrix } from '../api/client'

export default function Alerts() {
  // ── Webhook état ─────────────────────────────────────────────────────────────
  const [config, setConfig]         = useState(null)
  const [enabled, setEnabled]       = useState(false)
  const [threshKwh, setThreshKwh]   = useState('')
  const [threshEur, setThreshEur]   = useState('')
  const [webhookUrl, setWebhookUrl] = useState('')

  // ── Awtrix3 état ─────────────────────────────────────────────────────────────
  const [awtrixEnabled,   setAwtrixEnabled]   = useState(false)
  const [awtrixUrl,       setAwtrixUrl]       = useState('')
  const [awtrixInterval,  setAwtrixInterval]  = useState('30')

  // ── UI état ──────────────────────────────────────────────────────────────────
  const [loading,       setLoading]       = useState(true)
  const [saving,        setSaving]        = useState(false)
  const [checking,      setChecking]      = useState(false)
  const [testingAwtrix, setTestingAwtrix] = useState(false)
  const [success,       setSuccess]       = useState(null)
  const [error,         setError]         = useState(null)

  useEffect(() => {
    fetchAlertConfig()
      .then((d) => {
        setConfig(d)
        setEnabled(d.enabled)
        setThreshKwh(d.threshold_kwh > 0 ? String(d.threshold_kwh) : '')
        setThreshEur(d.threshold_eur > 0 ? String(d.threshold_eur) : '')
        setWebhookUrl(d.webhook_url || '')
        setAwtrixEnabled(d.awtrix_enabled ?? false)
        setAwtrixUrl(d.awtrix_url || '')
        setAwtrixInterval(String(d.awtrix_update_interval_min ?? 30))
      })
      .catch(() => setError('Impossible de charger la configuration'))
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    setSaving(true); setSuccess(null); setError(null)
    try {
      const updated = await updateAlertConfig({
        enabled,
        threshold_kwh:              parseFloat(threshKwh) || 0,
        threshold_eur:              parseFloat(threshEur) || 0,
        webhook_url:                webhookUrl,
        awtrix_enabled:             awtrixEnabled,
        awtrix_url:                 awtrixUrl,
        awtrix_update_interval_min: parseInt(awtrixInterval) || 30,
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

  const handleTestAwtrix = async () => {
    setTestingAwtrix(true); setSuccess(null); setError(null)
    try {
      await testAwtrix(awtrixUrl)
      setSuccess("Notification de test envoyée à l'horloge Awtrix3.")
    } catch (e) {
      setError(e.response?.data?.detail || "Impossible de joindre l'horloge Awtrix3")
    } finally {
      setTestingAwtrix(false)
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
      <Paper sx={{ p: 3, borderRadius: 3, maxWidth: 560 }}>
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

      {/* ── Section 2 : Horloge Awtrix3 ─────────────────────────────────────── */}
      <Paper sx={{ p: 3, borderRadius: 3, maxWidth: 560, mt: 3 }}>
        <Typography variant="h6" fontWeight={600} gutterBottom>Horloge Awtrix3</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Notifie votre horloge LED à chaque événement de charge en temps réel.
        </Typography>

        <FormControlLabel
          control={<Switch checked={awtrixEnabled} onChange={(e) => setAwtrixEnabled(e.target.checked)} color="primary" />}
          label={<Typography fontWeight={600}>Notifications Awtrix activées</Typography>}
          sx={{ mb: 2 }}
        />

        <Grid container spacing={2}>
          <Grid item xs={12}>
            <TextField
              fullWidth size="small" label="URL Awtrix3"
              value={awtrixUrl} onChange={(e) => setAwtrixUrl(e.target.value)}
              disabled={!awtrixEnabled}
              placeholder="http://awtrix.home.lan"
              helperText="Adresse de l'horloge sur votre réseau local"
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth size="small" label="Intervalle mise à jour (min)" type="number"
              value={awtrixInterval} onChange={(e) => setAwtrixInterval(e.target.value)}
              disabled={!awtrixEnabled}
              helperText="Fréquence des updates de progression"
              inputProps={{ min: 5, max: 120, step: 5 }}
            />
          </Grid>
        </Grid>

        <Box sx={{ display: 'flex', gap: 2, mt: 3 }}>
          <Button
            variant="outlined"
            startIcon={testingAwtrix ? <CircularProgress size={16} /> : <WifiIcon />}
            onClick={handleTestAwtrix}
            disabled={!awtrixEnabled || !awtrixUrl || testingAwtrix}
          >
            Tester la connexion
          </Button>
        </Box>

        <Divider sx={{ my: 2 }} />
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Trois notifications automatiques lors des charges :
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          <Chip label="Début — éphémère 10 s" color="success" size="small" />
          <Chip label={`Update — app persistante toutes les ${awtrixInterval} min`} color="info" size="small" />
          <Chip label="Fin — hold jusqu'au bouton" color="warning" size="small" />
        </Box>
      </Paper>

      {/* ── Bouton Enregistrer global ─────────────────────────────────────────── */}
      <Box sx={{ mt: 3, maxWidth: 560 }}>
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
