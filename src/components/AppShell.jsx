import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router'
import { ArrowDownLeft, ArrowUpRight, LayoutDashboard, LogOut, Menu, ShieldCheck, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import Logo from './Logo'
import { ButtonLoader } from './Loader'

export default function AppShell({ children, title, eyebrow, actions }) {
  const { profile, user, role, signOut } = useAuth()
  const [signingOut, setSigningOut] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const drawerRef = useRef(null)
  const closeButtonRef = useRef(null)
  const name = profile?.full_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Member'
  const homePath = role === 'admin' ? '/admin' : '/dashboard'
  const links = role === 'admin'
    ? [{ to: '/admin', label: 'Admin dashboard', icon: ShieldCheck, end: true }]
    : [
        { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, end: true },
        { to: '/dashboard/deposit', label: 'Deposit', icon: ArrowDownLeft },
        { to: '/dashboard/withdraw', label: 'Transfer', icon: ArrowUpRight },
      ]

  useEffect(() => { setMenuOpen(false) }, [location.pathname])
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 980px)')
    const closeOnDesktop = () => { if (desktop.matches) setMenuOpen(false) }
    desktop.addEventListener('change', closeOnDesktop)
    return () => desktop.removeEventListener('change', closeOnDesktop)
  }, [])

  useEffect(() => {
    if (!menuOpen) return undefined
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus())

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
        return
      }
      if (event.key !== 'Tab') return
      const focusable = drawerRef.current?.querySelectorAll('a[href], button:not(:disabled)')
      if (!focusable?.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      previousFocus?.focus()
    }
  }, [menuOpen])

  const logout = async () => {
    setSigningOut(true)
    setMenuOpen(false)
    await signOut()
    navigate('/', { replace: true })
  }

  const navigation = (mobile = false) => (
    <nav aria-label={mobile ? 'Mobile account navigation' : 'Account navigation'}>
      {links.map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} onClick={() => setMenuOpen(false)}>
          <Icon size={19} /><span>{label}</span>
        </NavLink>
      ))}
    </nav>
  )

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <Logo inverse />
        {navigation()}
        <div className="sidebar-note"><span>MELLOW STATUS</span><strong><i /> Connected</strong><small>Supabase-backed session</small></div>
        <button className="sidebar-logout" type="button" onClick={logout} disabled={signingOut}>{signingOut ? <ButtonLoader label="Signing out" /> : <><LogOut size={18} /><span>Sign out</span></>}</button>
      </aside>
      <div className="app-main">
        <header className="app-topbar">
          <div className="app-mobile-leading">
            <button className="mobile-menu-trigger" type="button" onClick={() => setMenuOpen(true)} aria-label="Open navigation menu" aria-expanded={menuOpen} aria-controls="mobile-account-navigation"><Menu size={21} /></button>
            <div className="app-mobile-brand"><Logo compact /></div>
          </div>
          <div className="app-heading"><span>{eyebrow}</span><h1>{title}</h1></div>
          <div className="app-topbar__right">{actions}<button className="mobile-logout" type="button" onClick={logout} disabled={signingOut} aria-label="Sign out">{signingOut ? <ButtonLoader label="" /> : <LogOut size={17} />}</button><Link className="profile-pill" to={homePath}><span>{name.slice(0, 1).toUpperCase()}</span><div><strong>{name}</strong><small>{role === 'admin' ? 'Administrator' : 'Member'}</small></div></Link></div>
        </header>
        <div className="app-content">{children}</div>
      </div>
      {menuOpen && <div className="mobile-navigation-layer">
        <button className="mobile-navigation-backdrop" type="button" onClick={() => setMenuOpen(false)} aria-label="Close navigation menu" />
        <aside className="mobile-navigation-drawer" id="mobile-account-navigation" ref={drawerRef} role="dialog" aria-modal="true" aria-label="Account pages">
          <div className="mobile-navigation-heading"><Logo inverse /><button ref={closeButtonRef} type="button" onClick={() => setMenuOpen(false)} aria-label="Close navigation menu"><X size={21} /></button></div>
          {navigation(true)}
          <div className="mobile-navigation-member"><span>{name.slice(0, 1).toUpperCase()}</span><div><strong>{name}</strong><small>{role === 'admin' ? 'Administrator' : 'Member'}</small></div></div>
          <button className="sidebar-logout" type="button" onClick={logout} disabled={signingOut}>{signingOut ? <ButtonLoader label="Signing out" /> : <><LogOut size={18} /><span>Sign out</span></>}</button>
        </aside>
      </div>}
    </div>
  )
}
