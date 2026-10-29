import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, ArrowLeft, BellRing, ChevronRight, KeyRound, Landmark, RefreshCw, ShieldCheck, Trash2, WalletCards } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import AppShell from '../components/AppShell'
import Loader, { ButtonLoader } from '../components/Loader'
import SetupNotice from '../components/SetupNotice'

const money = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0))
const dateTime = (value) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value))

export default function AdminMemberPage() {
  const { userId } = useParams()
  const { user: admin } = useAuth()
  const { showToast } = useToast()
  const navigate = useNavigate()
  const [member, setMember] = useState(null)
  const [accounts, setAccounts] = useState([])
  const [transferDrafts, setTransferDrafts] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [roleUpdating, setRoleUpdating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const loadData = useCallback(async (quiet = false) => {
    quiet ? setRefreshing(true) : setLoading(true)
    const [profileResult, accountResult, draftResult] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email, role, created_at').eq('id', userId).maybeSingle(),
      supabase.from('accounts').select('id, user_id, name, type, balance, last4').eq('user_id', userId).order('created_at'),
      supabase.from('member_transfer_drafts').select('method, authorization_started_at, updated_at').eq('user_id', userId).order('updated_at', { ascending: false }),
    ])
    const failure = profileResult.error || accountResult.error || draftResult.error
    if (failure) setError(failure.message)
    else {
      setMember(profileResult.data)
      setAccounts(accountResult.data || [])
      setTransferDrafts(draftResult.data || [])
      setError('')
      if (quiet) showToast('Member details refreshed.', 'success')
    }
    setLoading(false)
    setRefreshing(false)
  }, [userId, showToast])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => { if (error) showToast(error, 'error') }, [error, showToast])

  const totalBalance = useMemo(() => accounts.reduce((sum, account) => sum + Number(account.balance), 0), [accounts])
  const changeRole = async () => {
    setRoleUpdating(true)
    const role = member.role === 'admin' ? 'member' : 'admin'
    try {
      const { error: roleError } = await supabase.from('profiles').update({ role }).eq('id', member.id)
      if (roleError) showToast(roleError.message, 'error')
      else {
        setMember((current) => ({ ...current, role }))
        showToast(`${member.full_name} is now ${role === 'admin' ? 'an administrator' : 'a member'}.`, 'success')
      }
    } catch (requestError) {
      showToast(requestError.message || 'The member role could not be changed.', 'error')
    } finally {
      setRoleUpdating(false)
    }
  }

  const deleteMember = async () => {
    setDeleting(true)
    try {
      const { data, error: deleteError } = await supabase.functions.invoke('delete-member', { body: { userId } })
      const failureMessage = data?.error || deleteError?.message
      if (failureMessage || data?.deleted !== true) {
        showToast(failureMessage || 'The member could not be deleted. Please try again.', 'error')
        return
      }
      showToast(`${member.full_name} was deleted successfully.`, 'success')
      navigate('/admin', { replace: true })
    } catch (requestError) {
      showToast(requestError.message || 'The member could not be deleted. Check the delete-member function and try again.', 'error')
    } finally {
      setDeleting(false)
    }
  }

  if (loading) return <Loader fullScreen label="Loading member details" />
  if (!member) return <AppShell title="Member not found" eyebrow="MELLORA ADMINISTRATION"><Link className="payment-back" to="/admin"><ArrowLeft size={17} />Back to members</Link><SetupNotice message={error || 'This member profile does not exist.'} /></AppShell>

  const tools = [
    { path: 'deposit', eyebrow: 'INDIVIDUAL DEPOSIT SETTINGS', title: 'Payment instructions', description: 'Set member-specific bank details, amount, reason, and instructions.', icon: Landmark },
    { path: 'balances', eyebrow: 'ACCOUNT BALANCES', title: 'Set balances', description: `Manage ${accounts.length} ${accounts.length === 1 ? 'account' : 'accounts'} and record balance adjustments.`, icon: WalletCards },
    { path: 'notifications', eyebrow: 'INDIVIDUAL NOTIFICATIONS', title: 'Messages', description: 'Send direct admin messages and review notification history.', icon: BellRing },
    { path: 'activity', eyebrow: 'MEMBER ACTIVITY', title: 'Recent clicks and steps', description: 'Review deposit, transfer, authorization, Processing, and Pending events.', icon: Activity },
    { path: 'methods', eyebrow: 'TRANSFER AUTHORIZATION', title: 'Method codes and fees', description: `${transferDrafts.length} previewed ${transferDrafts.length === 1 ? 'method' : 'methods'} with independent code sets and progress.`, icon: KeyRound },
  ]

  return (
    <AppShell title={member.full_name} eyebrow="INDIVIDUAL MEMBER MANAGEMENT" actions={<button className="icon-action" type="button" onClick={() => loadData(true)} disabled={refreshing} aria-label="Refresh member details">{refreshing ? <ButtonLoader label="" /> : <RefreshCw size={18} />}</button>}>
      <Link className="payment-back" to="/admin"><ArrowLeft size={17} />Back to members</Link>
      {error && <SetupNotice message={error} />}
      <section className="member-profile-header">
        <div className="member-profile-identity"><span>{member.full_name.slice(0, 1).toUpperCase()}</span><div><small>MEMBER PROFILE</small><h2>{member.full_name}</h2><p>{member.email}</p></div></div>
        <dl><div><dt>Member ID</dt><dd>{member.id}</dd></div><div><dt>Joined</dt><dd>{dateTime(member.created_at)}</dd></div><div><dt>Total balance</dt><dd>{money(totalBalance)}</dd></div><div><dt>Role</dt><dd><span className={`role-badge role-badge--${member.role}`}>{member.role}</span></dd></div></dl>
        <div className="member-profile-actions"><button type="button" onClick={changeRole} disabled={roleUpdating || member.id === admin.id}>{roleUpdating ? <ButtonLoader label="Updating" /> : <><ShieldCheck size={16} />{member.id === admin.id ? 'Current session' : member.role === 'admin' ? 'Make member' : 'Make admin'}</>}</button><button type="button" onClick={() => navigate(`/admin/members/${member.id}/activity`)}>View activity<ChevronRight size={16} /></button></div>
      </section>

      <section className="member-admin-tool-grid" aria-label="Member management pages">
        {tools.map(({ path, eyebrow, title, description, icon: Icon }) => <Link key={path} to={`/admin/members/${member.id}/${path}`} className="admin-panel member-tool-link"><div><span>{eyebrow}</span><h2>{title}</h2><p>{description}</p></div><span className="member-tool-link__action"><Icon size={20} /><ChevronRight size={18} /></span></Link>)}
      </section>

      <section className="admin-panel member-tool member-danger-tool member-delete-overview">
        <div className="card-heading"><div><span>ACCOUNT ACCESS</span><h2>Delete user</h2><p>This permanently deletes the login, profile, accounts, transfer requests, settings, drafts, and notifications.</p></div><Trash2 size={21} /></div>
        {member.id === admin.id ? <p className="member-delete-note">You cannot delete your own active administrator account.</p> : !confirmDelete ? <button className="member-delete-button" type="button" onClick={() => setConfirmDelete(true)}><Trash2 size={16} />Delete {member.full_name}</button> : <div className="member-delete-confirm" role="alert"><strong>Permanently delete this user?</strong><p>This action cannot be undone.</p><div><button type="button" onClick={() => setConfirmDelete(false)} disabled={deleting}>Cancel</button><button type="button" onClick={deleteMember} disabled={deleting}>{deleting ? <ButtonLoader label="Deleting" /> : 'Yes, delete user'}</button></div></div>}
      </section>
    </AppShell>
  )
}
