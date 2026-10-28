import { Navigate, Link, useLocation } from 'react-router'
import { ArrowLeft, ShieldX } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import Loader from './Loader'

export default function ProtectedRoute({ children, adminOnly = false, memberOnly = false }) {
  const { user, role, loading, profileError } = useAuth()
  const location = useLocation()

  if (loading) return <Loader fullScreen label="Checking your secure session" />
  if (!user) return <Navigate to="/auth" replace state={{ from: location.pathname }} />
  if (memberOnly && role === 'admin') return <Navigate to="/admin" replace />
  if (adminOnly && role !== 'admin') {
    return (
      <main className="access-denied">
        <ShieldX size={48} />
        <span>ADMIN ACCESS</span>
        <h1>This area is reserved.</h1>
        <p>{profileError ? 'The admin role could not be verified. Run the supplied Supabase schema, then try again.' : 'Your current member profile does not have administrator permission.'}</p>
        <Link className="button button--green" to="/dashboard"><ArrowLeft size={17} /> Back to dashboard</Link>
      </main>
    )
  }
  return children
}
