import { useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router'
import { LayoutDashboard, LogOut, ShieldCheck, UserRound } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import Logo from './Logo'
import { ButtonLoader } from './Loader'

export default function AppShell({ children, title, eyebrow, actions }) {
  const { profile, user, role, signOut } = useAuth()
  const [signingOut, setSigningOut] = useState(false)
  const navigate = useNavigate()
  const name = profile?.full_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Member'
  const homePath = role === 'admin' ? '/admin' : '/dashboard'

  const logout = async () => {
    setSigningOut(true)
    await signOut()
    navigate('/', { replace: true })
  }

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <Logo inverse />
        <nav aria-label="Account navigation">
          {role === 'admin' ? <NavLink to="/admin"><ShieldCheck size={19} /><span>Admin dashboard</span></NavLink> : <NavLink to="/dashboard"><LayoutDashboard size={19} /><span>My dashboard</span></NavLink>}
        </nav>
        <div className="sidebar-note"><span>MELLOW STATUS</span><strong><i /> Connected</strong><small>Supabase-backed session</small></div>
        <button className="sidebar-logout" type="button" onClick={logout} disabled={signingOut}>{signingOut ? <ButtonLoader label="Signing out" /> : <><LogOut size={18} /><span>Sign out</span></>}</button>
      </aside>
      <div className="app-main">
        <header className="app-topbar">
          <div className="app-mobile-brand"><Logo compact /></div>
          <div className="app-heading"><span>{eyebrow}</span><h1>{title}</h1></div>
          <div className="app-topbar__right">{actions}<button className="mobile-logout" type="button" onClick={logout} disabled={signingOut} aria-label="Sign out">{signingOut ? <ButtonLoader label="" /> : <LogOut size={17} />}</button><Link className="profile-pill" to={homePath}><span>{name.slice(0, 1).toUpperCase()}</span><div><strong>{name}</strong><small>{role === 'admin' ? 'Administrator' : 'Member'}</small></div></Link></div>
        </header>
        <div className="app-content">{children}</div>
      </div>
    </div>
  )
}
