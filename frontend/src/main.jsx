/**
 * Point d'entrée de l'application React.
 *
 * Configure :
 *  - BrowserRouter (navigation côté client, côté serveur nginx gère le fallback via try_files)
 *  - ThemeProvider MUI avec un thème sombre personnalisé
 *  - CssBaseline (reset CSS cohérent entre navigateurs)
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material'
import App from './App'

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#00b4d8' },
    secondary: { main: '#90e0ef' },
    background: { default: '#0d1117', paper: '#161b22' },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", sans-serif',
  },
  shape: { borderRadius: 12 },
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <App />
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
)
