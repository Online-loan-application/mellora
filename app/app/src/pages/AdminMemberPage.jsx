import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, ArrowLeft, BellRing, Check, CheckCircle2, ChevronRight, Copy, KeyRound, Landmark, Pencil, RefreshCw, Save, Send, ShieldCheck, Trash2, UserRound, WalletCards, X } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import AppShell from '../components/AppShell'
import Loader, { ButtonLoader } from '../components/Loader'
import SetupNotice from '../components/SetupNotice'

const money = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0))
const dateTime = (value) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
const emptyDeposit = { bank_name: '', bank_branch: '', account_name: '', account_number: '', routing_number: '', account_type: '', amount: '', reason: '', instructions: '' }
const codeDetails = [
  { name: 'Identity Verification', purpose: 'Confirms that the member authorizes this transfer from their own account.' },
  { name: 'Recipient Confirmation', purpose: 'Confirms that the saved recipient details are correct and approved by the member.' },
  { name: 'Security Authorization', purpose: 'Adds a security check before the transfer can be prepared for review.' },
  { name: 'Transfer Release', purpose: 'Confirms final approval to submit the transfer for administrative processing.' },
]
const activityLabels = {
  deposit_clicked: 'Clicked Deposit',
  withdrawal_started: 'Started a transfer',
  withdrawal_details_saved: 'Saved recipient account details',
  withdrawal_amount_entered: 'Entered a transfer amount',
  withdrawal_previewed: 'Reviewed the transfer preview',
  withdrawal_serial_codes_started: 'Opened serial-code entry',
  withdrawal_serial_code_confirmed: 'Confirmed a serial code',
  withdrawal_submitted: 'Submitted a transfer request',
}

function DepositSettings({ memberId, adminId, value, onSaved }) {
  const [form, setForm] = useState(emptyDeposit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setForm({ ...emptyDeposit, ...value, amount: value?.user_id ? Number(value.amount).toFixed(2) : '' }) }, [value])
  const update = (field, next) => setForm((current) => ({ ...current, [field]: next }))

  const save = async (event) => {
    event.preventDefault()
    const amount = Math.round((Number(form.amount) + Number.EPSILON) * 100) / 100
    if (!form.bank_name.trim() || !form.account_name.trim() || !form.account_number.trim() || !form.reason.trim()) {
      setError('Enter the bank, account name, account number, and payment context.')
      return
    }
    if (!Number.isFinite(amount) || amount <= 0 || amount > 999999999999.99) {
      setError('Enter a valid required amount greater than zero.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = {
        user_id: memberId,
        bank_name: form.bank_name.trim(), bank_branch: form.bank_branch.trim(), account_name: form.account_name.trim(),
        account_number: form.account_number.trim(), routing_number: form.routing_number.trim(), account_type: form.account_type.trim(),
        amount, reason: form.reason.trim(), instructions: form.instructions.trim(),
        updated_by: adminId, updated_at: new Date().toISOString(),
      }
      const { error: saveError } = await supabase.from('member_deposit_settings').upsert(payload, { onConflict: 'user_id' })
      if (saveError) setError(saveError.message)
      else onSaved(payload)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="admin-panel member-tool member-deposit-tool">
      <div className="card-heading"><div><span>INDIVIDUAL DEPOSIT SETTINGS</span><h2>Payment instructions</h2><p>Only this member sees these account details, required amount, and payment context.</p></div><Landmark size={22} /></div>
      {error && <p className="member-tool-error" role="alert">{error}</p>}
      <form className="member-form" onSubmit={save}>
        <div className="member-form-grid">
          <label><span>Bank name</span><input value={form.bank_name} onChange={(event) => update('bank_name', event.target.value)} maxLength="120" required /></label>
          <label><span>Bank branch <small>Optional</small></span><input value={form.bank_branch} onChange={(event) => update('bank_branch', event.target.value)} maxLength="120" autoComplete="off" /></label>
          <label><span>Account name</span><input value={form.account_name} onChange={(event) => update('account_name', event.target.value)} maxLength="120" required /></label>
          <label><span>Account type <small>Optional</small></span><input value={form.account_type} onChange={(event) => update('account_type', event.target.value)} maxLength="60" placeholder="Checking, savings, or other" autoComplete="off" /></label>
          <label><span>Account number</span><input value={form.account_number} onChange={(event) => update('account_number', event.target.value)} maxLength="34" autoComplete="off" required /></label>
          <label><span>Routing number <small>Optional</small></span><input value={form.routing_number} onChange={(event) => update('routing_number', event.target.value)} maxLength="34" autoComplete="off" /></label>
          <label><span>Required amount (USD)</span><input type="number" min="0.01" max="999999999999.99" step="0.01" value={form.amount} onChange={(event) => update('amount', event.target.value)} required /></label>
          <label className="member-form-wide"><span>Why the payment is needed</span><input value={form.reason} onChange={(event) => update('reason', event.target.value)} maxLength="240" required /></label>
          <label className="member-form-wide"><span>Additional instructions <small>Optional</small></span><textarea rows="3" value={form.instructions} onChange={(event) => update('instructions', event.target.value)} maxLength="600" /></label>
        </div>
        <div className="member-form-footer"><small>Member-specific · never changes the balance</small><button className="button button--green" type="submit" disabled={saving}>{saving ? <ButtonLoader label="Saving" /> : <><Save size={16} />Save instructions</>}</button></div>
      </form>
    </section>
  )
}

function BalanceManager({ accounts, onUpdated }) {
  const [editing, setEditing] = useState('')
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const save = async (event, account) => {
    event.preventDefault()
    const balance = Math.round((Number(value) + Number.EPSILON) * 100) / 100
    if (!Number.isFinite(balance) || balance < 0 || balance > 999999999999.99) {
      setError('Enter a valid account balance.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const { error: updateError } = await supabase.rpc('admin_set_account_balance', { p_account_id: account.id, p_balance: balance })
      if (updateError) setError(updateError.message)
      else {
        onUpdated(account, balance)
        setEditing('')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="admin-panel member-tool">
      <div className="card-heading"><div><span>ACCOUNT BALANCES</span><h2>Set balances</h2></div><WalletCards size={22} /></div>
      {error && <p className="member-tool-error" role="alert">{error}</p>}
      <div className="member-balance-list">
        {accounts.map((account) => (
          <div className="member-balance-row" key={account.id}>
            <div><strong>{account.name}</strong><small>{account.type} · •• {account.last4}</small></div>
            {editing === account.id ? (
              <form onSubmit={(event) => save(event, account)}>
                <input type="number" min="0" max="999999999999.99" step="0.01" value={value} onChange={(event) => setValue(event.target.value)} aria-label={`New balance for ${account.name}`} autoFocus required />
                <button type="submit" disabled={saving} aria-label="Save balance">{saving ? <ButtonLoader label="" /> : <Check size={16} />}</button>
                <button type="button" onClick={() => setEditing('')} disabled={saving} aria-label="Cancel balance edit"><X size={16} /></button>
              </form>
            ) : (
              <div className="member-balance-current"><strong>{money(account.balance)}</strong><button type="button" onClick={() => { setEditing(account.id); setValue(Number(account.balance).toFixed(2)); setError('') }}><Pencil size={14} />Edit</button></div>
            )}
          </div>
        ))}
        {!accounts.length && <p className="empty-copy">This member has no accounts.</p>}
      </div>
    </section>
  )
}

function NotificationManager({ member, adminId, notifications, onSent }) {
  const [form, setForm] = useState({ title: '', body: '' })
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const send = async (event) => {
    event.preventDefault()
    if (!form.title.trim() || !form.body.trim()) { setError('Enter a notification title and message.'); return }
    setSending(true)
    setError('')
    try {
      const { error: sendError } = await supabase.from('notifications').insert({ user_id: member.id, created_by: adminId, type: 'admin', title: form.title.trim(), message: form.body.trim() })
      if (sendError) setError(sendError.message)
      else { setForm({ title: '', body: '' }); onSent(member.full_name) }
    } finally {
      setSending(false)
    }
  }
  return (
    <section className="admin-panel member-tool member-notification-tool">
      <div className="card-heading"><div><span>INDIVIDUAL NOTIFICATIONS</span><h2>Messages</h2></div><BellRing size={22} /></div>
      <div className="member-notification-list">
        {notifications.slice(0, 5).map((item) => <article key={item.id}><div><strong>{item.title}</strong><small>{dateTime(item.created_at)}</small></div><p>{item.message}</p><span>{item.read_at ? 'Read' : 'Unread'}</span></article>)}
        {!notifications.length && <p className="empty-copy">No notifications have been sent to this member.</p>}
      </div>
      <form className="member-notification-form" onSubmit={send}>
        {error && <p className="member-tool-error" role="alert">{error}</p>}
        <label><span>Title</span><input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} maxLength="120" required /></label>
        <label><span>Message</span><textarea rows="3" value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} maxLength="500" required /></label>
        <button className="button button--green" type="submit" disabled={sending}>{sending ? <ButtonLoader label="Sending" /> : <><Send size={15} />Send to {member.full_name.split(' ')[0]}</>}</button>
      </form>
    </section>
  )
}

function SerialCodeManager({ memberId, metadata, onReset }) {
  const [amounts, setAmounts] = useState(['', '', '', ''])
  const [generated, setGenerated] = useState([])
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  const [copiedAll, setCopiedAll] = useState(false)
  const [copiedSlot, setCopiedSlot] = useState(0)
  useEffect(() => {
    if (metadata.length === 4) setAmounts(metadata.slice(0, 4).map((item) => Number(item.amount).toFixed(2)))
  }, [metadata])
  const total = amounts.reduce((sum, value) => sum + (Number(value) || 0), 0)

  const generate = async (event) => {
    event.preventDefault()
    const numeric = amounts.map(Number)
    if (numeric.some((value) => !Number.isFinite(value) || value <= 0)) { setError('Enter an amount greater than zero for every code.'); return }
    if (metadata.length && !window.confirm('Reset all four codes and amounts? The current code set will stop working.')) return
    setProcessing(true)
    setError('')
    setCopiedAll(false)
    setCopiedSlot(0)
    try {
      const { data, error: resetError } = await supabase.rpc('admin_reset_member_serial_codes', { p_user_id: memberId, p_amounts: numeric })
      if (resetError) setError(resetError.message)
      else { setGenerated(data || []); onReset(data || []) }
    } finally {
      setProcessing(false)
    }
  }
  const copyText = async (text, slot = 0) => {
    try {
      await navigator.clipboard.writeText(text)
      if (slot) setCopiedSlot(slot)
      else setCopiedAll(true)
      setError('')
    } catch { setError('Copying is unavailable. Select and copy the codes manually.') }
  }
  const copyCodes = () => copyText(generated.map((item) => `Code ${item.slot}: ${item.code} — Fee ${money(item.amount)} — ${item.code_name} — ${item.code_purpose}`).join('\n'))

  return (
    <section className="admin-panel member-tool member-code-tool">
      <div className="card-heading"><div><span>INDIVIDUAL SERIAL CODES</span><h2>Codes and fee amounts</h2><p>Each amount you enter is the fee displayed on that code’s page. A matching member code marks the fee as paid.</p></div><KeyRound size={22} /></div>
      {error && <p className="member-tool-error" role="alert">{error}</p>}
      <form onSubmit={generate}>
        <div className="code-amount-grid">{amounts.map((value, index) => <label key={index}><span>Code {index + 1} fee</span><div className="code-amount-input"><span>$</span><input type="number" min="0.01" max="999999999999.99" step="0.01" value={value} onChange={(event) => setAmounts((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} required /></div><small className="code-fee-name">{codeDetails[index].name}</small><small className="code-fee-reason">{codeDetails[index].purpose}</small></label>)}</div>
        <div className="code-total"><span>Total code fees<small>Four separate fees · not added to the transfer amount</small></span><strong>{money(total)}</strong></div>
        <button className="button button--green" type="submit" disabled={processing}>{processing ? <ButtonLoader label="Generating" /> : <><RefreshCw size={16} />{metadata.length ? 'Reset codes & fees' : 'Generate codes & fees'}</>}</button>
      </form>
      {generated.length > 0 && <div className="generated-codes"><div><span>NEW CODE SET</span><button type="button" onClick={copyCodes}>{copiedAll ? <Check size={15} /> : <Copy size={15} />}{copiedAll ? 'Copied all' : 'Copy all'}</button></div><p>Copy each code now. Plaintext codes are shown only after generation and are not stored.</p><ol>{generated.map((item) => <li key={item.slot}><div className="generated-code-heading"><span>Code {item.slot} · {item.code_name}</span><button type="button" onClick={() => copyText(item.code, item.slot)} aria-label={`Copy serial code ${item.slot}`}>{copiedSlot === item.slot ? <Check size={14} /> : <Copy size={14} />}{copiedSlot === item.slot ? 'Copied' : 'Copy code'}</button></div><strong>{item.code}</strong><small>{money(item.amount)} fee · Unpaid</small><p>{item.code_purpose}</p></li>)}</ol></div>}
      {metadata.length > 0 && <div className="code-metadata"><span>CURRENT CODE STATUS</span><div>{metadata.map((item) => <span key={item.slot}>Code {item.slot} · {item.code_name}<strong>{money(item.amount)}</strong><small>{item.paid_at ? `Fee paid ${dateTime(item.paid_at)}` : 'Fee unpaid'}{item.used_at ? ` · Used ${dateTime(item.used_at)}` : ''}</small><p>{item.code_purpose}</p></span>)}</div></div>}
    </section>
  )
}

export default function AdminMemberPage() {
  const { userId } = useParams()
  const { user: admin } = useAuth()
  const navigate = useNavigate()
  const [member, setMember] = useState(null)
  const [accounts, setAccounts] = useState([])
  const [notifications, setNotifications] = useState([])
  const [activities, setActivities] = useState([])
  const [deposit, setDeposit] = useState(null)
  const [codeMetadata, setCodeMetadata] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [roleUpdating, setRoleUpdating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const loadData = useCallback(async (quiet = false) => {
    quiet ? setRefreshing(true) : setLoading(true)
    const [profileResult, accountResult, notificationResult, activityResult, depositResult, codeResult] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email, role, created_at').eq('id', userId).maybeSingle(),
      supabase.from('accounts').select('id, user_id, name, type, balance, last4').eq('user_id', userId).order('created_at'),
      supabase.from('notifications').select('id, title, message, read_at, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(10),
      supabase.from('member_activities').select('id, type, metadata, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(20),
      supabase.from('member_deposit_settings').select('*').eq('user_id', userId).limit(1),
      supabase.rpc('admin_get_member_serial_codes', { p_user_id: userId }),
    ])
    const failure = profileResult.error || accountResult.error || notificationResult.error || activityResult.error || depositResult.error || codeResult.error
    if (failure) setError(failure.message)
    else {
      setMember(profileResult.data)
      setAccounts(accountResult.data || [])
      setNotifications(notificationResult.data || [])
      setActivities(activityResult.data || [])
      setDeposit(depositResult.data?.[0] || { user_id: userId, ...emptyDeposit, amount: 0 })
      setCodeMetadata(codeResult.data || [])
      setError('')
    }
    setLoading(false)
    setRefreshing(false)
  }, [userId])
  useEffect(() => { loadData() }, [loadData])

  const totalBalance = useMemo(() => accounts.reduce((sum, account) => sum + Number(account.balance), 0), [accounts])
  const changeRole = async () => {
    setRoleUpdating(true)
    setNotice('')
    const role = member.role === 'admin' ? 'member' : 'admin'
    const { error: roleError } = await supabase.from('profiles').update({ role }).eq('id', member.id)
    if (roleError) setNotice(roleError.message)
    else { setMember((current) => ({ ...current, role })); setNotice(`${member.full_name} is now ${role === 'admin' ? 'an administrator' : 'a member'}.`) }
    setRoleUpdating(false)
  }
  const deleteMember = async () => {
    setDeleting(true)
    setNotice('')
    try {
      const { data, error: deleteError } = await supabase.functions.invoke('delete-member', { body: { userId } })
      if (deleteError || data?.error) setNotice(deleteError?.message || data?.error || 'The member could not be deleted.')
      else navigate('/admin', { replace: true })
    } finally {
      setDeleting(false)
    }
  }

  if (loading) return <Loader fullScreen label="Loading member details" />
  if (!member) return <AppShell title="Member not found" eyebrow="MELLORA ADMINISTRATION"><Link className="payment-back" to="/admin"><ArrowLeft size={17} />Back to members</Link><SetupNotice message={error || 'This member profile does not exist.'} /></AppShell>

  return (
    <AppShell title={member.full_name} eyebrow="INDIVIDUAL MEMBER MANAGEMENT" actions={<button className="icon-action" type="button" onClick={() => loadData(true)} disabled={refreshing} aria-label="Refresh member details">{refreshing ? <ButtonLoader label="" /> : <RefreshCw size={18} />}</button>}>
      <Link className="payment-back" to="/admin"><ArrowLeft size={17} />Back to members</Link>
      {error && <SetupNotice message={error} />}
      {notice && <div className="admin-notice" role="status"><CheckCircle2 size={18} />{notice}</div>}
      <section className="member-profile-header">
        <div className="member-profile-identity"><span>{member.full_name.slice(0, 1).toUpperCase()}</span><div><small>MEMBER PROFILE</small><h2>{member.full_name}</h2><p>{member.email}</p></div></div>
        <dl><div><dt>Member ID</dt><dd>{member.id}</dd></div><div><dt>Joined</dt><dd>{dateTime(member.created_at)}</dd></div><div><dt>Total balance</dt><dd>{money(totalBalance)}</dd></div><div><dt>Role</dt><dd><span className={`role-badge role-badge--${member.role}`}>{member.role}</span></dd></div></dl>
        <div className="member-profile-actions"><button type="button" onClick={changeRole} disabled={roleUpdating || member.id === admin.id}>{roleUpdating ? <ButtonLoader label="Updating" /> : <><ShieldCheck size={16} />{member.id === admin.id ? 'Current session' : member.role === 'admin' ? 'Make member' : 'Make admin'}</>}</button><button type="button" onClick={() => document.getElementById('member-activity')?.scrollIntoView({ behavior: 'smooth' })}>View activity<ChevronRight size={16} /></button></div>
      </section>

      <div className="member-admin-layout">
        <div className="member-admin-main">
          <DepositSettings memberId={member.id} adminId={admin.id} value={deposit} onSaved={(value) => { setDeposit(value); setNotice(`Deposit instructions updated for ${member.full_name}.`) }} />
          <SerialCodeManager memberId={member.id} metadata={codeMetadata} onReset={() => { setNotice(`A new four-code set was generated for ${member.full_name}.`); loadData(true) }} />
        </div>
        <aside className="member-admin-side">
          <BalanceManager accounts={accounts} onUpdated={(account, balance) => { setAccounts((items) => items.map((item) => item.id === account.id ? { ...item, balance } : item)); setNotice(`${account.name} updated to ${money(balance)}.`) }} />
          <NotificationManager member={member} adminId={admin.id} notifications={notifications} onSent={(name) => { setNotice(`Notification sent to ${name}.`); loadData(true) }} />
          <section className="admin-panel member-tool member-activity-tool" id="member-activity">
            <div className="card-heading"><div><span>MEMBER ACTIVITY</span><h2>Recent clicks and steps</h2></div><Activity size={22} /></div>
            <div className="member-activity-list">{activities.map((item) => <article key={item.id}><i /><div><strong>{item.type === 'withdrawal_serial_code_confirmed' ? `Confirmed serial code ${item.metadata?.slot || ''}` : activityLabels[item.type] || item.type}</strong><small>{dateTime(item.created_at)}</small>{item.metadata?.amount && <span>{money(item.metadata.amount)}{item.metadata?.fee != null ? ` · ${money(item.metadata.fee)} fee` : ''}</span>}</div></article>)}{!activities.length && <p className="empty-copy">No deposit or withdrawal activity has been recorded.</p>}</div>
          </section>
          <section className="admin-panel member-tool member-danger-tool">
            <div className="card-heading"><div><span>ACCOUNT ACCESS</span><h2>Delete user</h2><p>This permanently deletes the login, profile, accounts, requests, settings, and notifications.</p></div><Trash2 size={21} /></div>
            {member.id === admin.id ? <p className="member-delete-note">You cannot delete your own active administrator account.</p> : !confirmDelete ? <button className="member-delete-button" type="button" onClick={() => setConfirmDelete(true)}><Trash2 size={16} />Delete {member.full_name}</button> : <div className="member-delete-confirm" role="alert"><strong>Permanently delete this user?</strong><p>This action cannot be undone.</p><div><button type="button" onClick={() => setConfirmDelete(false)} disabled={deleting}>Cancel</button><button type="button" onClick={deleteMember} disabled={deleting}>{deleting ? <ButtonLoader label="Deleting" /> : 'Yes, delete user'}</button></div></div>}
          </section>
        </aside>
      </div>
    </AppShell>
  )
}
