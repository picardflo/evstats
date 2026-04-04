/**
 * Racine de l'application — définit les routes React Router.
 *
 * Routes :
 *   /dashboard → Dashboard (graphiques + KPIs)
 *   /import    → Import XLSX
 *   /sessions  → Tableau des sessions + export CSV
 *   /settings  → Configuration des tarifs EDF
 */
import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Import from './pages/Import'
import Sessions from './pages/Sessions'
import Settings from './pages/Settings'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/import" element={<Import />} />
        <Route path="/sessions" element={<Sessions />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Layout>
  )
}
