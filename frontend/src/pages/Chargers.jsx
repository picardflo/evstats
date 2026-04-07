/**
 * Page Chargeurs — gestion des bornes EVSE via UDP direct.
 *
 * Fonctionnalités :
 *   - Liste des bornes enregistrées (carte par borne)
 *   - Photo de la borne (upload JPEG/PNG/WebP)
 *   - Statut temps réel : tension, courant, puissance (bouton Rafraîchir)
 *   - Ajout / modification via dialog avec test de connexion intégré
 *   - Adresse IP ou FQDN (ex: morec.home.lan)
 *   - Suppression avec confirmation
 */
import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  Box, Typography, Button, Card, CardContent, CardActions, CardMedia,
  Chip, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, IconButton, Tooltip, Alert, CircularProgress,
  Divider, Stack, Switch, FormControlLabel,
} from '@mui/material'
import AddIcon            from '@mui/icons-material/Add'
import EditIcon           from '@mui/icons-material/Edit'
import DeleteIcon         from '@mui/icons-material/Delete'
import RefreshIcon        from '@mui/icons-material/Refresh'
import EvStationIcon      from '@mui/icons-material/EvStation'
import WifiIcon           from '@mui/icons-material/Wifi'
import WifiOffIcon        from '@mui/icons-material/WifiOff'
import BoltIcon           from '@mui/icons-material/Bolt'
import CheckCircleIcon    from '@mui/icons-material/CheckCircle'
import PhotoCameraIcon    from '@mui/icons-material/PhotoCamera'
import {
  fetchChargers, createCharger, updateCharger, deleteCharger,
  testChargerPreSave, fetchChargerStatus,
  uploadChargerImage, chargerImageUrl,
} from '../api/client'

const EMPTY_FORM = {
  name: '', ip: '', password: '', serial: '', src_port: 6186,
  model: '', firmware: '', is_enabled: true,
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// ── Carte d'une borne ─────────────────────────────────────────────────────────

function ChargerCard({ charger, onEdit, onDelete, onRefresh, onImageUpload, status, statusLoading }) {
  const fileRef = useRef()
  const [imgKey, setImgKey] = useState(0)  // force reload image après upload

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    await onImageUpload(charger.id, file)
    setImgKey(k => k + 1)
  }

  return (
    <Card sx={{
      border: charger.is_enabled ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(255,255,255,0.04)',
      opacity: charger.is_enabled ? 1 : 0.6,
    }}>
      {/* Photo */}
      <Box sx={{ position: 'relative' }}>
        {charger.image_filename ? (
          <CardMedia
            component="img"
            height="160"
            image={`${chargerImageUrl(charger.id)}?v=${imgKey}`}
            alt={charger.name}
            sx={{ objectFit: 'cover' }}
          />
        ) : (
          <Box sx={{
            height: 100, display: 'flex', alignItems: 'center', justifyContent: 'center',
            bgcolor: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}>
            <EvStationIcon sx={{ fontSize: 48, color: 'rgba(255,255,255,0.15)' }} />
          </Box>
        )}
        {/* Bouton upload photo */}
        <Tooltip title="Changer la photo">
          <IconButton
            size="small"
            onClick={() => fileRef.current?.click()}
            sx={{
              position: 'absolute', bottom: 6, right: 6,
              bgcolor: 'rgba(0,0,0,0.6)', '&:hover': { bgcolor: 'rgba(0,0,0,0.85)' },
            }}
          >
            <PhotoCameraIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
      </Box>

      <CardContent>
        {/* En-tête */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Typography variant="h6" fontWeight={600} sx={{ flex: 1 }}>
            {charger.name}
          </Typography>
          {charger.is_enabled ? (
            <Chip icon={<WifiIcon sx={{ fontSize: 14 }} />} label="Activée"
              size="small" color="success" variant="outlined" />
          ) : (
            <Chip icon={<WifiOffIcon sx={{ fontSize: 14 }} />} label="Désactivée"
              size="small" color="default" variant="outlined" />
          )}
        </Box>

        {/* Infos borne */}
        <Stack spacing={0.5} sx={{ mb: 2 }}>
          <Typography variant="body2" color="text.secondary">
            <b style={{ color: '#fff' }}>{charger.ip}</b>
            {charger.model && <> · {charger.model}</>}
            {charger.firmware && <> · fw {charger.firmware}</>}
          </Typography>
          {charger.serial && (
            <Typography variant="caption" color="text.secondary" fontFamily="monospace">
              Série : {charger.serial}
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary">
            Dernière connexion : {fmtDate(charger.last_seen)}
          </Typography>
        </Stack>

        {/* Statut temps réel */}
        <Divider sx={{ mb: 1.5 }} />
        {statusLoading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
            <CircularProgress size={16} />
            <Typography variant="body2" color="text.secondary">Interrogation en cours…</Typography>
          </Box>
        ) : status ? (
          <Stack direction="row" spacing={2} flexWrap="wrap">
            <Box>
              <Typography variant="caption" color="text.secondary">Tension</Typography>
              <Typography variant="body1" fontWeight={600}>
                {status.voltage != null ? `${status.voltage} V` : '—'}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Courant</Typography>
              <Typography variant="body1" fontWeight={600}>
                {status.current != null ? `${status.current} A` : '—'}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Puissance</Typography>
              <Typography variant="body1" fontWeight={600}>
                {status.power_w != null ? `${(status.power_w / 1000).toFixed(2)} kW` : '—'}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'flex-end' }}>
              {status.is_charging ? (
                <Chip icon={<BoltIcon sx={{ fontSize: 14 }} />} label="En charge"
                  size="small" color="success" />
              ) : (
                <Chip label="En veille" size="small" color="default" variant="outlined" />
              )}
            </Box>
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            Statut non chargé — cliquez sur Rafraîchir
          </Typography>
        )}
      </CardContent>

      <CardActions sx={{ px: 2, pb: 2, gap: 1 }}>
        <Button
          size="small"
          startIcon={statusLoading ? <CircularProgress size={14} /> : <RefreshIcon />}
          onClick={() => onRefresh(charger)}
          disabled={statusLoading || !charger.is_enabled || !charger.serial}
        >
          Rafraîchir
        </Button>
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Modifier">
          <IconButton size="small" onClick={() => onEdit(charger)}>
            <EditIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Supprimer">
          <IconButton size="small" color="error" onClick={() => onDelete(charger)}>
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </CardActions>
    </Card>
  )
}

// ── Dialog Ajout / Modification ───────────────────────────────────────────────

function ChargerDialog({ open, onClose, onSave, initial }) {
  const isEdit = !!initial?.id
  const [form, setForm]             = useState(EMPTY_FORM)
  const [testing, setTesting]       = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [testError, setTestError]   = useState(null)
  const [saving, setSaving]         = useState(false)

  useEffect(() => {
    if (open) {
      setForm(initial ? {
        name:       initial.name,
        ip:         initial.ip,
        password:   '',
        serial:     initial.serial,
        src_port:   initial.src_port,
        model:      initial.model,
        firmware:   initial.firmware,
        is_enabled: initial.is_enabled,
      } : EMPTY_FORM)
      setTestResult(null)
      setTestError(null)
    }
  }, [open, initial])

  const set = (field) => (e) => {
    const val = e.target.type === 'checkbox' ? e.target.checked : e.target.value
    setForm(f => ({ ...f, [field]: val }))
    if (field === 'ip' || field === 'password') {
      setTestResult(null)
      setTestError(null)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    setTestError(null)
    try {
      const res = await testChargerPreSave({ ip: form.ip, password: form.password })
      setTestResult(res)
      setForm(f => ({
        ...f,
        serial:   res.serial   || f.serial,
        src_port: res.src_port || f.src_port,
      }))
    } catch (err) {
      const msg = err?.response?.data?.detail || err.message || 'Erreur de connexion'
      setTestError(msg)
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(form, initial?.id)
      onClose()
    } catch (err) {
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  const canTest = form.ip.trim() && form.password.trim()
  const canSave = form.name.trim() && form.ip.trim() && form.password.trim()

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {isEdit ? 'Modifier la borne' : 'Ajouter une borne'}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Nom"
            value={form.name}
            onChange={set('name')}
            fullWidth
            placeholder="ex : Morec Garage"
          />
          <TextField
            label="Adresse IP ou hostname"
            value={form.ip}
            onChange={set('ip')}
            fullWidth
            placeholder="ex : 192.168.11.134 ou morec.home.lan"
            helperText="Adresse IP ou nom DNS local (FQDN)"
          />
          <TextField
            label="Mot de passe (6 chiffres)"
            value={form.password}
            onChange={set('password')}
            fullWidth
            type="password"
            placeholder="ex : 202604"
            helperText="Mot de passe configuré dans l'application EVSEMaster"
          />

          {/* Bouton Test */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <Button
              variant="outlined"
              startIcon={testing ? <CircularProgress size={16} /> : <WifiIcon />}
              onClick={handleTest}
              disabled={!canTest || testing}
            >
              Tester la connexion
            </Button>
            <Typography variant="caption" color="text.secondary">
              L'app EVSEMaster doit être fermée pendant le test
            </Typography>
          </Box>

          {testError && (
            <Alert severity="error" sx={{ whiteSpace: 'pre-wrap' }}>{testError}</Alert>
          )}
          {testResult && (
            <Alert severity="success" icon={<CheckCircleIcon />}>
              <Typography variant="body2" fontWeight={600}>Connexion réussie !</Typography>
              <Typography variant="caption" component="div">
                Série : <code>{testResult.serial}</code>
              </Typography>
              {testResult.voltage != null && (
                <Typography variant="caption" component="div">
                  Statut : {testResult.voltage} V · {testResult.current} A · {testResult.power_w} W
                </Typography>
              )}
            </Alert>
          )}

          <Divider />

          <Typography variant="caption" color="text.secondary">
            Champs optionnels (renseignés automatiquement après test)
          </Typography>
          <Stack direction="row" spacing={2}>
            <TextField label="Modèle" value={form.model} onChange={set('model')}
              fullWidth placeholder="ex : SQW49" size="small" />
            <TextField label="Firmware" value={form.firmware} onChange={set('firmware')}
              fullWidth placeholder="ex : 313251.118A0053" size="small" />
          </Stack>
          <FormControlLabel
            control={<Switch checked={form.is_enabled} onChange={set('is_enabled')} />}
            label="Borne activée"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Annuler</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={!canSave || saving}
          startIcon={saving ? <CircularProgress size={16} /> : null}
        >
          {isEdit ? 'Enregistrer' : 'Ajouter'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ── Dialog Suppression ────────────────────────────────────────────────────────

function DeleteDialog({ charger, onClose, onConfirm }) {
  return (
    <Dialog open={!!charger} onClose={onClose}>
      <DialogTitle>Supprimer la borne</DialogTitle>
      <DialogContent>
        <Typography>
          Supprimer <b>{charger?.name}</b> ({charger?.ip}) ?
          Cette action est irréversible.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annuler</Button>
        <Button color="error" variant="contained" onClick={onConfirm}>Supprimer</Button>
      </DialogActions>
    </Dialog>
  )
}

// ── Page principale ───────────────────────────────────────────────────────────

export default function Chargers() {
  const [chargers, setChargers]           = useState([])
  const [loading, setLoading]             = useState(true)
  const [dialogOpen, setDialogOpen]       = useState(false)
  const [editCharger, setEditCharger]     = useState(null)
  const [deleteTarget, setDeleteTarget]   = useState(null)
  const [statuses, setStatuses]           = useState({})
  const [loadingStatus, setLoadingStatus] = useState({})
  const [error, setError]                 = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setChargers(await fetchChargers())
    } catch {
      setError('Erreur lors du chargement des bornes')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleRefresh = async (charger) => {
    setLoadingStatus(s => ({ ...s, [charger.id]: true }))
    setError(null)
    try {
      const status = await fetchChargerStatus(charger.id)
      setStatuses(s => ({ ...s, [charger.id]: status }))
      setChargers(cs => cs.map(c => c.id === charger.id
        ? { ...c, last_seen: status.last_seen }
        : c
      ))
    } catch (err) {
      const msg = err?.response?.data?.detail || 'Erreur de connexion à la borne'
      setError(`${charger.name} : ${msg}`)
    } finally {
      setLoadingStatus(s => ({ ...s, [charger.id]: false }))
    }
  }

  const handleSave = async (form, id) => {
    if (id) {
      await updateCharger(id, form)
    } else {
      await createCharger(form)
    }
    await load()
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    await deleteCharger(deleteTarget.id)
    setDeleteTarget(null)
    await load()
  }

  const handleImageUpload = async (id, file) => {
    try {
      const updated = await uploadChargerImage(id, file)
      setChargers(cs => cs.map(c => c.id === id ? updated : c))
    } catch (err) {
      setError('Erreur lors de l\'upload de la photo')
    }
  }

  return (
    <Box>
      {/* En-tête */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <EvStationIcon sx={{ color: 'primary.main', fontSize: 28 }} />
          <Typography variant="h5" fontWeight={700}>Chargeurs</Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => { setEditCharger(null); setDialogOpen(true) }}
        >
          Ajouter une borne
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Alert severity="info" sx={{ mb: 3 }} icon={<WifiIcon />}>
        <Typography variant="body2">
          <b>Protocole UDP direct (EVSEMaster)</b> — La borne diffuse un broadcast sur le port 28376.
          L'application EVSEMaster doit être fermée lors des tests (une seule session UDP à la fois).
        </Typography>
      </Alert>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : chargers.length === 0 ? (
        <Box sx={{
          textAlign: 'center', py: 8,
          border: '1px dashed rgba(255,255,255,0.15)', borderRadius: 2,
        }}>
          <EvStationIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
          <Typography color="text.secondary">Aucune borne configurée</Typography>
          <Button
            sx={{ mt: 2 }} variant="outlined" startIcon={<AddIcon />}
            onClick={() => { setEditCharger(null); setDialogOpen(true) }}
          >
            Ajouter une borne
          </Button>
        </Box>
      ) : (
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' },
          gap: 2,
        }}>
          {chargers.map(c => (
            <ChargerCard
              key={c.id}
              charger={c}
              status={statuses[c.id]}
              statusLoading={!!loadingStatus[c.id]}
              onEdit={(ch) => { setEditCharger(ch); setDialogOpen(true) }}
              onDelete={setDeleteTarget}
              onRefresh={handleRefresh}
              onImageUpload={handleImageUpload}
            />
          ))}
        </Box>
      )}

      <ChargerDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSave={handleSave}
        initial={editCharger}
      />
      <DeleteDialog
        charger={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
    </Box>
  )
}
