/**
 * Page Import — import de fichiers .xlsx EVSEMaster.
 *
 * Fonctionnalités :
 *  - Zone de drag & drop (événements onDragOver/onDragLeave/onDrop)
 *  - Sélection via input file caché (déclenché par clic sur la zone ou le bouton)
 *  - Feedback immédiat : loader pendant l'upload, résumé succès/erreur
 *  - Historique des imports en bas de page (rechargé après chaque import)
 *
 * Le backend gère la déduplication : importer deux fois le même fichier
 * ne crée pas de doublons.
 */
import React, { useState, useCallback, useEffect } from 'react'
import {
  Box, Typography, Paper, Button, Alert, CircularProgress,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Chip,
} from '@mui/material'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import { importXlsx, fetchImports } from '../api/client'

export default function Import() {
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [history, setHistory] = useState([])

  const loadHistory = useCallback(async () => {
    try {
      const data = await fetchImports()
      setHistory(data)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])

  const handleFile = useCallback(async (file) => {
    if (!file || !file.name.endsWith('.xlsx')) {
      setError('Veuillez sélectionner un fichier .xlsx')
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const data = await importXlsx(file)
      setResult(data)
      loadHistory()
    } catch (e) {
      setError(e.response?.data?.detail || 'Erreur lors de l\'import')
    } finally {
      setLoading(false)
    }
  }, [loadHistory])

  const onDrop = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    handleFile(file)
  }, [handleFile])

  const onFileInput = (e) => handleFile(e.target.files[0])

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        Import XLSX
      </Typography>

      {/* Zone de dépôt */}
      <Paper
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        sx={{
          border: '2px dashed',
          borderColor: dragging ? 'primary.main' : 'rgba(255,255,255,0.2)',
          borderRadius: 3,
          p: 6,
          textAlign: 'center',
          cursor: 'pointer',
          transition: 'border-color 0.2s',
          bgcolor: dragging ? 'rgba(0,180,216,0.06)' : 'background.paper',
          mb: 3,
        }}
        onClick={() => document.getElementById('file-input').click()}
      >
        <input id="file-input" type="file" accept=".xlsx" hidden onChange={onFileInput} />
        <UploadFileIcon sx={{ fontSize: 56, color: 'primary.main', mb: 2 }} />
        <Typography variant="h6" gutterBottom>
          Glissez votre fichier .xlsx ici
        </Typography>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          ou cliquez pour sélectionner
        </Typography>
        <Button variant="contained" sx={{ mt: 2 }} onClick={(e) => { e.stopPropagation(); document.getElementById('file-input').click() }}>
          Parcourir
        </Button>
      </Paper>

      {loading && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
          <CircularProgress size={24} />
          <Typography>Import en cours…</Typography>
        </Box>
      )}

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {result && (
        <Alert severity="success" icon={<CheckCircleIcon />} sx={{ mb: 3 }}>
          <Typography fontWeight={700}>{result.filename}</Typography>
          <Typography variant="body2">
            {result.new_rows} nouvelles sessions importées · {result.duplicate_rows} doublons ignorés · {result.total_rows} lignes au total
          </Typography>
        </Alert>
      )}

      {/* Historique des imports */}
      {history.length > 0 && (
        <>
          <Typography variant="h6" fontWeight={600} gutterBottom>
            Historique des imports
          </Typography>
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Fichier</TableCell>
                  <TableCell>Date</TableCell>
                  <TableCell align="right">Total</TableCell>
                  <TableCell align="right">Nouvelles</TableCell>
                  <TableCell align="right">Doublons</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {history.map((h) => (
                  <TableRow key={h.id} hover>
                    <TableCell>{h.filename}</TableCell>
                    <TableCell>{new Date(h.imported_at).toLocaleString('fr-FR')}</TableCell>
                    <TableCell align="right">{h.total_rows}</TableCell>
                    <TableCell align="right">
                      <Chip label={h.new_rows} color="success" size="small" />
                    </TableCell>
                    <TableCell align="right">
                      <Chip label={h.duplicate_rows} color="default" size="small" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
    </Box>
  )
}
