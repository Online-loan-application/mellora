import { Link, Navigate, Route, Routes, useLocation } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import LandingPage from './pages/LandingPage'
import AuthPage, { AuthCallback } from './pages/AuthPage'
import DashboardPage from './pages/DashboardPage'
import DepositPage from './pages/DepositPage'
import WithdrawalPage from './pages/WithdrawalPage'
import AdminPage from './pages/AdminPage'
import AdminMemberPage from './pages/AdminMemberPage'
import AdminMethodPage from './pages/AdminMethodPage'
import AdminMemberToolPage from './pages/AdminMemberToolPage'
import AdminMemberMethodsPage from './pages/AdminMemberMethodsPage'
import ProtectedRoute from './components/ProtectedRoute'
import './App.css'

function NotFound() {
  return <main className="access-denied"><span>404</span><h1>This page drifted away.</h1><p>Return to Mellora and find your mellow again.</p><Link className="button button--green" to="/"><ArrowLeft size={17} /> Back home</Link></main>
}

export default function App() {
  const location = useLocation()
  return (
    <div className="screen-transition" key={location.pathname}>
      <Routes location={location}>
        <Route path="/" element={<LandingPage />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/dashboard" element={<ProtectedRoute memberOnly><DashboardPage /></ProtectedRoute>} />
        <Route path="/dashboard/processing" element={<ProtectedRoute memberOnly><DashboardPage initialView="processing" /></ProtectedRoute>} />
        <Route path="/dashboard/pending" element={<ProtectedRoute memberOnly><DashboardPage initialView="pending" /></ProtectedRoute>} />
        <Route path="/dashboard/deposit" element={<ProtectedRoute memberOnly><DepositPage /></ProtectedRoute>} />
        <Route path="/dashboard/withdraw" element={<ProtectedRoute memberOnly><WithdrawalPage /></ProtectedRoute>} />
        <Route path="/admin" element={<ProtectedRoute adminOnly><AdminPage /></ProtectedRoute>} />
        <Route path="/admin/members/:userId" element={<ProtectedRoute adminOnly><AdminMemberPage /></ProtectedRoute>} />
        <Route path="/admin/members/:userId/methods/:method" element={<ProtectedRoute adminOnly><AdminMethodPage /></ProtectedRoute>} />
        <Route path="/admin/members/:userId/methods" element={<ProtectedRoute adminOnly><AdminMemberMethodsPage /></ProtectedRoute>} />
        <Route path="/admin/members/:userId/deposit" element={<ProtectedRoute adminOnly><AdminMemberToolPage tool="deposit" /></ProtectedRoute>} />
        <Route path="/admin/members/:userId/balances" element={<ProtectedRoute adminOnly><AdminMemberToolPage tool="balances" /></ProtectedRoute>} />
        <Route path="/admin/members/:userId/notifications" element={<ProtectedRoute adminOnly><AdminMemberToolPage tool="notifications" /></ProtectedRoute>} />
        <Route path="/admin/members/:userId/activity" element={<ProtectedRoute adminOnly><AdminMemberToolPage tool="activity" /></ProtectedRoute>} />
        <Route path="/home" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </div>
  )
}
