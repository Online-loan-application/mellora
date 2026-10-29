import { useEffect, useState } from 'react'
import { Activity, BellRing, Check, Landmark, Pencil, Save, Send, WalletCards, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useToast } from '../context/ToastContext'
import { getTransferMethod } from '../lib/transferMethods'
import { ButtonLoader } from './Loader'

const money = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0))
const dateTime = (value) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
const emptyDeposit = { bank_name: '', bank_branch: '', account_name: '', account_number: '', routing_number: '', account_type: '', amount: '', reason: '', instructions: '' }
const activityLabels = {
  deposit_clicked: 'Clicked Deposit',
  withdrawal_started: 'Started a transfer',
  withdrawal_method_selected: 'Selected a transfer method',
  withdrawal_details_saved: 'Saved recipient account details',
  withdrawal_amount_entered: 'Entered a transfer amount',
  withdrawal_previewed: 'Reviewed the transfer preview',
  withdrawal_serial_codes_started: 'Started transfer authorization',
  withdrawal_serial_code_confirmed: 'Confirmed an authorization',
  withdrawal_draft_resumed: 'Resumed a saved transfer',
  transfer_processing: 'Transfer entered Processing',
  transfer_pending: 'Transfer moved to Pending',
  withdrawal_submitted: 'Submitted a transfer request',
}

export function DepositSettings({ memberId, adminId, value, onSaved }) {
  const { showToast } = useToast()
  const [form, setForm] = useState(emptyDeposit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setForm({ ...emptyDeposit, ...value, amount: value?.user_id ? Number(value.amount).toFixed(2) : '' }) }, [value])
  const update = (field, next) => setForm((current) => ({ ...current, [field]: next }))
  const fail = (message) => { setError(message); showToast(message, 'error') }

  const save = async (event) => {
    event.preventDefault()
    const amount = Math.round((Number(form.amount) + Number.EPSILON) * 100) / 100
    if (!form.bank_name.trim() || !form.account_name.trim() || !form.account_number.trim() || !form.reason.trim()) {
      fail('Enter the bank, account name, account number, and payment context.')
      return
    }
    if (!Number.isFinite(amount) || amount <= 0 || amount > 999999999999.99) {
      fail('Enter a valid required amount greater than zero.')
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
      if (saveError) fail(saveError.message)
      else {
        onSaved(payload)
        showToast('Deposit instructions saved for this member.', 'success')
      }
    } catch (requestError) {
      fail(requestError.message || 'Deposit instructions could not be saved.')
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

export function BalanceManager({ accounts, onUpdated }) {
  const { showToast } = useToast()
  const [editing, setEditing] = useState('')
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fail = (message) => { setError(message); showToast(message, 'error') }

  const save = async (event, account) => {
    event.preventDefault()
    const balance = Math.round((Number(value) + Number.EPSILON) * 100) / 100
    if (!Number.isFinite(balance) || balance < 0 || balance > 999999999999.99) {
      fail('Enter a valid account balance.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const { error: updateError } = await supabase.rpc('admin_set_account_balance', { p_account_id: account.id, p_balance: balance })
      if (updateError) fail(updateError.message)
      else {
        onUpdated(account, balance)
        setEditing('')
        showToast(`${account.name} updated to ${money(balance)}.`, 'success')
      }
    } catch (requestError) {
      fail(requestError.message || 'The account balance could not be updated.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="admin-panel member-tool">
      <div className="card-heading"><div><span>ACCOUNT BALANCES</span><h2>Set balances</h2><p>Changes are recorded against this member’s account and reflected in their dashboard.</p></div><WalletCards size={22} /></div>
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

export function NotificationManager({ member, adminId, notifications, onSent }) {
  const { showToast } = useToast()
  const [form, setForm] = useState({ title: '', body: '' })
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const fail = (message) => { setError(message); showToast(message, 'error') }
  const send = async (event) => {
    event.preventDefault()
    if (!form.title.trim() || !form.body.trim()) { fail('Enter a notification title and message.'); return }
    setSending(true)
    setError('')
    try {
      const payload = { user_id: member.id, created_by: adminId, type: 'admin', title: form.title.trim(), message: form.body.trim() }
      const { error: sendError } = await supabase.from('notifications').insert(payload)
      if (sendError) fail(sendError.message)
      else {
        setForm({ title: '', body: '' })
        onSent(payload)
        showToast(`Notification sent to ${member.full_name}.`, 'success')
      }
    } catch (requestError) {
      fail(requestError.message || 'The notification could not be sent.')
    } finally {
      setSending(false)
    }
  }
  return (
    <section className="admin-panel member-tool member-notification-tool">
      <div className="card-heading"><div><span>INDIVIDUAL NOTIFICATIONS</span><h2>Messages</h2><p>Send a direct message or review this member’s notification history.</p></div><BellRing size={22} /></div>
      <div className="member-notification-list">
        {notifications.map((item) => <article key={item.id}><div><strong>{item.title}</strong><small>{dateTime(item.created_at)}</small></div><p>{item.message}</p><span>{item.read_at ? 'Read' : 'Unread'}</span></article>)}
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

export function MemberActivity({ activities }) {
  return (
    <section className="admin-panel member-tool member-activity-tool" id="member-activity">
      <div className="card-heading"><div><span>MEMBER ACTIVITY</span><h2>Recent clicks and steps</h2><p>Deposit, transfer, authorization, Processing, and Pending events recorded for this member.</p></div><Activity size={22} /></div>
      <div className="member-activity-list">{activities.map((item) => {
        const methodName = getTransferMethod(item.metadata?.method)?.name
        return <article key={item.id}><i /><div><strong>{activityLabels[item.type] || item.type}</strong><small>{dateTime(item.created_at)}{methodName ? ` · ${methodName}` : ''}</small>{item.metadata?.amount != null && <span>{money(item.metadata.amount)}{item.metadata?.fee != null ? ` · ${money(item.metadata.fee)} fee` : ''}</span>}</div></article>
      })}{!activities.length && <p className="empty-copy">No deposit or withdrawal activity has been recorded.</p>}</div>
    </section>
  )
}
