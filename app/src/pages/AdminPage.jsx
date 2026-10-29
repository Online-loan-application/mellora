import { useCallback, useEffect, useState } from 'react'
import { ChevronRight, RefreshCw, Search, UserRound } from 'lucide-react'
import { Link } from 'react-router'
import { supabase } from '../lib/supabase'
import AppShell from '../components/AppShell'
import Loader, { ButtonLoader } from '../components/Loader'
import SetupNotice from '../components/SetupNotice'
import { useToast } from '../context/ToastContext'

export default function AdminPage() {
  const { showToast } = useToast()
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')

  const loadMembers = useCallback(async (quiet = false) => {
    quiet ? setRefreshing(true) : setLoading(true)
    const { data, error: profileError } = await supabase
      .from('profiles')
      .select('id, full_name, email, role, created_at')
      .order('created_at', { ascending: false })
    if (profileError) setError(profileError.message)
    else {
      setProfiles(data || [])
      setError('')
      if (quiet) showToast('Member directory refreshed.', 'success')
    }
    setLoading(false)
    setRefreshing(false)
  }, [showToast])

  useEffect(() => { loadMembers() }, [loadMembers])
  useEffect(() => { if (error) showToast(error, 'error') }, [error, showToast])

  const filtered = profiles.filter((profile) => `${profile.full_name} ${profile.email}`.toLowerCase().includes(query.toLowerCase()))

  if (loading) return <Loader fullScreen label="Opening the member directory" />

  return (
    <AppShell title="Members" eyebrow="MELLORA ADMINISTRATION" actions={<button className="icon-action" type="button" onClick={() => loadMembers(true)} disabled={refreshing} aria-label="Refresh members">{refreshing ? <ButtonLoader label="" /> : <RefreshCw size={18} />}</button>}>
      {error && <SetupNotice message={error} />}
      <section className="admin-panel member-directory-page">
        <div className="section-line"><div><span>USER DIRECTORY</span><h2>Choose a member.</h2><p>Open an individual profile to manage balances, payments, notifications, serial codes, and account access.</p></div><label className="activity-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a user" aria-label="Search users" /></label></div>
        <div className="admin-member-list">
          {filtered.map((profile) => (
            <Link className="admin-member-link" to={`/admin/members/${profile.id}`} key={profile.id}>
              <span className="admin-member-avatar">{profile.full_name.slice(0, 1).toUpperCase()}</span>
              <span className="admin-member-identity"><strong>{profile.full_name}</strong><small>{profile.email}</small></span>
              <span className={`role-badge role-badge--${profile.role}`}>{profile.role}</span>
              <span className="admin-member-joined"><small>Joined</small>{new Date(profile.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
              <ChevronRight size={19} />
            </Link>
          ))}
        </div>
        {!filtered.length && <div className="admin-directory-empty"><UserRound size={24} /><strong>No users found</strong><p>No member profiles match your search.</p></div>}
      </section>
    </AppShell>
  )
}
