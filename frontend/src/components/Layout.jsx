/**
 * Layout principal — sidebar de navigation + zone de contenu.
 *
 * Sur desktop : sidebar permanente (Drawer variant="permanent").
 * Sur mobile  : AppBar avec burger menu + Drawer temporaire.
 *
 * Pour ajouter une page :
 *   1. Importer l'icône MUI souhaitée
 *   2. Ajouter une entrée dans le tableau NAV
 *   3. Ajouter la Route dans App.jsx
 */
import React, { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  Box, Drawer, AppBar, Toolbar, Typography, List, ListItem,
  ListItemButton, ListItemIcon, ListItemText, IconButton, useMediaQuery, useTheme,
} from '@mui/material'
import DashboardIcon from '@mui/icons-material/Dashboard'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import TableRowsIcon from '@mui/icons-material/TableRows'
import SettingsIcon from '@mui/icons-material/Settings'
import NotificationsIcon from '@mui/icons-material/Notifications'
import MenuIcon from '@mui/icons-material/Menu'
import BoltIcon from '@mui/icons-material/Bolt'
import DirectionsCarIcon from '@mui/icons-material/DirectionsCar'
import EvStationIcon from '@mui/icons-material/EvStation'
import { fetchVersion } from '../api/client'

const DRAWER_WIDTH = 220

const NAV = [
  { label: 'Dashboard',  path: '/dashboard', icon: <DashboardIcon /> },
  { label: 'Import',     path: '/import',    icon: <UploadFileIcon /> },
  { label: 'Sessions',   path: '/sessions',  icon: <TableRowsIcon /> },
  { label: 'Véhicule',   path: '/vehicle',   icon: <DirectionsCarIcon /> },
  { label: 'Chargeurs',  path: '/chargers',  icon: <EvStationIcon /> },
  { label: 'Alertes',    path: '/alerts',    icon: <NotificationsIcon /> },
  { label: 'Paramètres', path: '/settings',  icon: <SettingsIcon /> },
]

export default function Layout({ children }) {
  const navigate = useNavigate()
  const location = useLocation()
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'))
  const [mobileOpen, setMobileOpen] = useState(false)
  const [version, setVersion] = useState(null)

  useEffect(() => {
    fetchVersion().then(setVersion).catch(() => {})
  }, [])

  const drawer = (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
        <BoltIcon sx={{ color: 'primary.main', fontSize: 28 }} />
        <Typography variant="h6" fontWeight={700} color="primary.main">
          EVSE Stats
        </Typography>
      </Box>
      <List sx={{ flex: 1 }}>
        {NAV.map(({ label, path, icon }) => (
          <ListItem key={path} disablePadding>
            <ListItemButton
              selected={location.pathname === path}
              onClick={() => { navigate(path); setMobileOpen(false) }}
              sx={{
                mx: 1, borderRadius: 2,
                '&.Mui-selected': {
                  bgcolor: 'primary.main',
                  color: '#000',
                  '& .MuiListItemIcon-root': { color: '#000' },
                  '&:hover': { bgcolor: 'primary.dark' },
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: 36 }}>{icon}</ListItemIcon>
              <ListItemText primary={label} />
            </ListItemButton>
          </ListItem>
        ))}
      </List>

      {/* Footer version */}
      <Box sx={{ p: 2, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <Typography variant="caption" color="text.secondary" display="block">
          EVSE Stats {version ? `v${version}` : ''}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ opacity: 0.5 }}>
          Morec / EVSEMaster
        </Typography>
      </Box>
    </Box>
  )

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {!isMobile && (
        <Drawer
          variant="permanent"
          sx={{
            width: DRAWER_WIDTH,
            flexShrink: 0,
            '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box', borderRight: '1px solid rgba(255,255,255,0.08)' },
          }}
        >
          {drawer}
        </Drawer>
      )}

      {isMobile && (
        <>
          <AppBar position="fixed" color="transparent" elevation={0} sx={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <Toolbar>
              <IconButton edge="start" onClick={() => setMobileOpen(true)}>
                <MenuIcon />
              </IconButton>
              <BoltIcon sx={{ color: 'primary.main', ml: 1 }} />
              <Typography variant="h6" fontWeight={700} color="primary.main" sx={{ ml: 0.5 }}>
                EVSE Stats
              </Typography>
            </Toolbar>
          </AppBar>
          <Drawer open={mobileOpen} onClose={() => setMobileOpen(false)} sx={{ '& .MuiDrawer-paper': { width: DRAWER_WIDTH } }}>
            {drawer}
          </Drawer>
        </>
      )}

      <Box component="main" sx={{ flex: 1, p: { xs: 2, sm: 3 }, mt: isMobile ? 7 : 0, minHeight: '100vh' }}>
        {children}
      </Box>
    </Box>
  )
}
