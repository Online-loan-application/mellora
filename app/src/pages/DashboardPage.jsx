import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowDownLeft, ArrowUpRight, Clock3, Eye, EyeOff, RefreshCw, Search, WalletCards } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { trackActivity, trackDepositClick } from '../lib/activity'
import AppShell from '../components/AppShell'
import NotificationCenter from '../components/NotificationCenter'
import Loader, { ButtonLoader } from '../components/Loader'
import { useToast } from '../context/ToastContext'
import { getTransferMethod, transferMethods } from '../lib/transferMethods'

const money = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0))
const date = (value) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(value))
const fullDate = (value) => new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(value)
const localTime = (value) => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(value)

function CashflowChart({ transactions }) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const day = new Date()
    day.setHours(0, 0, 0, 0)
    day.setDate(day.getDate() - (6 - index))
    return day
  })
  const values = days.map((day) => {
    const next = new Date(day)
    next.setDate(next.getDate() + 1)
    return transactions.filter((item) => new Date(item.created_at) >= day && new Date(item.created_at) < next).reduce((sum, item) => sum + Math.abs(Number(item.amount)), 0)
  })
  const max = Math.max(...values, 1)
  return (
    <div className="cashflow-chart" role="img" aria-label="Seven day transaction activity">
      <div className="chart-y-labels"><span>{money(max)}</span><span>{money(max / 2)}</span><span>$0</span></div>
      <div className="cashflow-bars">{days.map((day, index) => <div className="cashflow-day" key={day.toISOString()}><div className="cashflow-bar-track"><i style={{ height: `${Math.max((values[index] / max) * 100, values[index] ? 6 : 1)}%`, animationDelay: `${index * 70}ms` }} /><span>{money(values[index])}</span></div><small>{day.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 2)}</small></div>)}</div>
    </div>
  )
}

function TransactionRow({ item }) {
  const incoming = Number(item.amount) > 0
  return (
    <div className="dashboard-transaction">
      <span className={`transaction-symbol ${incoming ? 'incoming' : ''}`}>{incoming ? <ArrowDownLeft size={19} /> : <ArrowUpRight size={19} />}</span>
      <div><strong>{item.merchant}</strong><span>{item.category} · {date(item.created_at)}</span></div>
      <span className="transaction-status">{item.status}</span>
      <b className={incoming ? 'incoming-text' : ''}>{incoming ? '+' : ''}{money(item.amount)}</b>
    </div>
  )
}

export default function DashboardPage({ initialView = 'overview' }) {
  const { user, profile, profileError } = useAuth()
  const { showToast } = useToast()
  const [accounts, setAccounts] = useState([])
  const [transactions, setTransactions] = useState([])
  const [withdrawals, setWithdrawals] = useState([])
  const [transferDrafts, setTransferDrafts] = useState([])
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [view, setView] = useState(initialView)
  const [visible, setVisible] = useState(true)
  const [query, setQuery] = useState('')
  const [now, setNow] = useState(() => new Date())
  const navigate = useNavigate()

  const loadData = useCallback(async (quiet = false) => {
    if (!user) return
    quiet ? setRefreshing(true) : setLoading(true)
    const [accountResult, transactionResult, withdrawalResult, draftResult, notificationResult] = await Promise.all([
      supabase.from('accounts').select('*').eq('user_id', user.id).order('created_at'),
      supabase.from('transactions').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
      supabase.from('withdrawal_requests').select('id, account_id, amount, status, transfer_method, network, created_at').eq('user_id', user.id).order('created_at', { ascending: false }),
      supabase.from('member_transfer_drafts').select('method, account_id, amount, confirmed_codes, authorization_started_at, created_at, updated_at').eq('user_id', user.id),
      supabase.from('notifications').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
    ])
    const failure = accountResult.error || transactionResult.error || withdrawalResult.error || draftResult.error || notificationResult.error
    if (failure) setError(failure.message)
    else {
      setAccounts(accountResult.data || [])
      setTransactions(transactionResult.data || [])
      setWithdrawals(withdrawalResult.data || [])
      setTransferDrafts(draftResult.data || [])
      setNotifications(notificationResult.data || [])
      setError('')
      if (quiet) showToast('Your dashboard is up to date.', 'success')
    }
    setLoading(false)
    setRefreshing(false)
  }, [user, showToast])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => {
    const message = error || profileError
    if (message) showToast(message, 'error')
  }, [error, profileError, showToast])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const transferStatus = useMemo(() => {
    const methodName = (id) => getTransferMethod(id || 'bank')?.name || 'Bank transfer'
    const fullyConfirmed = (draft) => Array.isArray(draft.confirmed_codes)
      && draft.confirmed_codes.length === 4 && draft.confirmed_codes.every(Boolean)
    const hasSavedRequest = (draft) => withdrawals.some((request) =>
      (request.transfer_method || 'bank') === draft.method
      && Math.abs(Number(request.amount)) === Math.abs(Number(draft.amount))
      && (!request.account_id || !draft.account_id || request.account_id === draft.account_id))
    const processing = transferDrafts.filter((draft) => draft.authorization_started_at && !fullyConfirmed(draft)).map((draft) => ({
      id: `processing-${draft.method}`,
      merchant: 'Processing transfer',
      category: `${methodName(draft.method)} · Authorization in progress`,
      account_id: draft.account_id,
      amount: -Math.abs(Number(draft.amount)),
      status: 'Processing',
      created_at: draft.updated_at || draft.created_at,
    }))
    const authorizedDrafts = transferDrafts.filter((draft) => draft.authorization_started_at && fullyConfirmed(draft) && !hasSavedRequest(draft))
    const pendingDrafts = authorizedDrafts.map((draft) => ({
      id: `pending-draft-${draft.method}`,
      merchant: 'Pending transfer',
      category: `${methodName(draft.method)} · Authorization complete`,
      account_id: draft.account_id,
      amount: -Math.abs(Number(draft.amount)),
      status: 'Pending',
      created_at: draft.updated_at || draft.created_at,
    }))
    const requestActivity = withdrawals.map((request) => ({
      id: `request-${request.id}`,
      merchant: `${request.status.charAt(0).toUpperCase()}${request.status.slice(1)} transfer`,
      category: `${methodName(request.transfer_method)} · Transfer request`,
      account_id: request.account_id,
      amount: -Math.abs(Number(request.amount)),
      status: `${request.status.charAt(0).toUpperCase()}${request.status.slice(1)}`,
      created_at: request.created_at,
    }))
    const pendingRequests = requestActivity.filter((item, index) => withdrawals[index].status === 'pending')
    const activity = [...transactions, ...processing, ...pendingDrafts, ...requestActivity]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    return { processing, pending: [...pendingDrafts, ...pendingRequests], activity }
  }, [transferDrafts, withdrawals, transactions])
  const totals = useMemo(() => {
    const processing = transferStatus.processing.reduce((sum, item) => sum + Math.abs(Number(item.amount)), 0)
    const pending = transferStatus.pending.reduce((sum, item) => sum + Math.abs(Number(item.amount)), 0)
    const completedWithdrawals = withdrawals
      .filter((item) => item.status === 'approved' || item.status === 'completed')
      .reduce((sum, item) => sum + Math.abs(Number(item.amount)), 0)
    const accountBalance = accounts.reduce((sum, item) => sum + Number(item.balance), 0)
    return {
      balance: Math.max(0, accountBalance - processing - pending),
      income: transactions
        .filter((item) => item.merchant === 'Admin balance adjustment'
          && item.category === 'Balance adjustment' && Number(item.amount) > 0)
        .reduce((sum, item) => sum + Number(item.amount), 0),
      withdrawn: completedWithdrawals + processing + pending,
      processing,
      pending,
    }
  }, [accounts, transactions, withdrawals, transferStatus])
  const availableByAccount = useMemo(() => {
    const reserved = {}
    ;[...transferStatus.processing, ...transferStatus.pending].forEach((item) => {
      if (item.account_id) reserved[item.account_id] = (reserved[item.account_id] || 0) + Math.abs(Number(item.amount))
    })
    return Object.fromEntries(accounts.map((account) => [
      account.id,
      Math.max(0, Number(account.balance || 0) - (reserved[account.id] || 0)),
    ]))
  }, [accounts, transferStatus])
  const filtered = transferStatus.activity.filter((item) => `${item.merchant} ${item.category}`.toLowerCase().includes(query.toLowerCase()))
  const statusItems = view === 'processing' ? transferStatus.processing : transferStatus.pending
  const firstName = (profile?.full_name || user?.email?.split('@')[0] || 'there').split(' ')[0]
  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  if (loading) return <Loader fullScreen label="Opening your mellow dashboard" />

  return (
    <AppShell title={`${greeting}, ${firstName}.`} eyebrow="YOUR FINANCIAL OVERVIEW" actions={<><NotificationCenter notifications={notifications} setNotifications={setNotifications} /><button className="icon-action" type="button" onClick={() => loadData(true)} disabled={refreshing} aria-label="Refresh dashboard">{refreshing ? <ButtonLoader label="" /> : <RefreshCw size={18} />}</button></>}>
      <div className="dashboard-tabs" role="tablist" aria-label="Dashboard views">{['overview', 'accounts', 'activity'].map((item) => <button key={item} role="tab" aria-selected={view === item} className={view === item ? 'active' : ''} onClick={() => setView(item)}>{item === 'overview' ? 'Overview' : item === 'accounts' ? 'My accounts' : 'Activity'}</button>)}</div>
      <div className="dashboard-datetime" aria-label={`Local date and time: ${fullDate(now)}, ${localTime(now)}`}>
        <Clock3 size={20} />
        <div><span>YOUR LOCAL TIME</span><strong>{localTime(now)}</strong></div>
        <p>{fullDate(now)}</p>
      </div>
      {view === 'overview' && <>
        <section className="balance-hero">
          <div className="balance-hero__top"><span>AVAILABLE BALANCE</span><button type="button" onClick={() => setVisible(!visible)} aria-label={visible ? 'Hide balances' : 'Show balances'}>{visible ? <Eye size={18} /> : <EyeOff size={18} />}</button></div>
          <strong>{visible ? money(totals.balance) : '••••••••'}</strong>
          <p><span><i /> Live from Supabase</span> across {accounts.length} accounts</p>
          <div className="balance-hero__stats"><div><span>Money in</span><strong>{visible ? money(totals.income) : '••••'}</strong></div><div><span>Money out</span><strong>{visible ? money(totals.withdrawn) : '••••'}</strong></div></div>
          <div className="balance-actions"><button type="button" onClick={() => { trackDepositClick(); navigate('/dashboard/deposit') }}><ArrowDownLeft size={17} />Deposit</button><button type="button" onClick={() => { trackActivity('withdrawal_started'); navigate('/dashboard/withdraw') }} disabled={!accounts.length}><ArrowUpRight size={17} />Transfer</button></div>
          <div className="balance-orb" aria-hidden="true"><i /><i /><span /></div>
        </section>
        {(totals.processing > 0 || totals.pending > 0) && <section className="transfer-status-grid" aria-label="Transfer status totals">
          {totals.processing > 0 && <button type="button" className="transfer-status-card processing" onClick={() => navigate('/dashboard/processing')}>
            <span className="transfer-status-card__icon"><RefreshCw size={20} /></span>
            <div><span>PROCESSING TRANSFERS</span><strong>{visible ? money(totals.processing) : '••••'}</strong><small>{transferStatus.processing.length} in progress</small></div>
            <ArrowUpRight size={18} />
          </button>}
          {totals.pending > 0 && <button type="button" className="transfer-status-card pending" onClick={() => navigate('/dashboard/pending')}>
            <span className="transfer-status-card__icon"><Clock3 size={20} /></span>
            <div><span>PENDING TRANSFERS</span><strong>{visible ? money(totals.pending) : '••••'}</strong><small>{transferStatus.pending.length} awaiting review</small></div>
            <ArrowUpRight size={18} />
          </button>}
        </section>}
        <section className="dashboard-card transfer-methods-card" aria-labelledby="withdrawal-methods-title">
          <div className="card-heading"><div><span>WITHDRAWAL METHODS</span><h2 id="withdrawal-methods-title">Choose how to send.</h2></div><small>From your available balance</small></div>
          <div className="dashboard-transfer-methods">
            {transferMethods.map((method) => {
              const MethodIcon = method.icon
              return <button type="button" key={method.id} aria-label={`Transfer with ${method.name}`} title={method.description} onClick={() => { trackActivity('withdrawal_method_selected', { method: method.id }); navigate('/dashboard/withdraw', { state: { method: method.id } }) }}>
                <span className="transfer-method-icon"><MethodIcon size={22} /></span>
                <span className="transfer-method-label">{method.id === 'bank' ? 'Bank' : method.name}</span>
              </button>
            })}
          </div>
        </section>
        <div className="dashboard-grid">
          <section className="dashboard-card cashflow-card"><div className="card-heading"><div><span>CASH FLOW</span><h2>Your week in motion</h2></div><small>Last 7 days</small></div><CashflowChart transactions={transactions} /></section>
          <section className="dashboard-card accounts-card"><div className="card-heading"><div><span>ACCOUNTS</span><h2>Your pockets</h2></div><WalletCards size={20} /></div>{accounts.map((account, index) => <div className="account-mini" key={account.id}><span className={`account-mini__icon account-mini__icon--${index % 2}`}><WalletCards size={19} /></span><div><strong>{account.name}</strong><small>•• {account.last4}</small></div><b>{visible ? money(availableByAccount[account.id]) : '••••'}</b></div>)}{!accounts.length && !error && <p className="empty-copy">No accounts yet. Accounts will appear here after the database setup is complete.</p>}</section>
        </div>
        <section className="dashboard-card recent-card"><div className="card-heading"><div><span>RECENT ACTIVITY</span><h2>Latest account updates</h2></div><button type="button" onClick={() => setView('activity')}>View all <ArrowUpRight size={16} /></button></div>{transferStatus.activity.slice(0, 5).map((item) => <TransactionRow key={item.id} item={item} />)}{!transferStatus.activity.length && !error && <p className="empty-copy">Your transaction and transfer activity will appear here.</p>}</section>
      </>}

      {view === 'accounts' && <section className="accounts-full"><div className="section-line"><div><span>YOUR ACCOUNTS</span><h2>Every balance, one view.</h2></div><button className="icon-action" type="button" onClick={() => setVisible(!visible)}>{visible ? <Eye size={18} /> : <EyeOff size={18} />}</button></div><div className="account-card-grid">{accounts.map((account, index) => <article className={`account-full-card account-full-card--${index % 2}`} key={account.id}><div><span>{account.type}</span><small>•••• {account.last4}</small></div><h3>{account.name}</h3><strong>{visible ? money(availableByAccount[account.id]) : '••••••'}</strong><p>{account.currency} · Available balance</p><div className="account-card-lines"><i /><i /><i /></div></article>)}</div></section>}

      {(view === 'processing' || view === 'pending') && <section className="dashboard-card activity-full transfer-status-view">
        <div className="section-line"><div><span>{view === 'processing' ? 'PROCESSING TRANSFERS' : 'PENDING TRANSFERS'}</span><h2>{view === 'processing' ? 'Authorization in progress.' : 'Awaiting review.'}</h2><p>{view === 'processing' ? 'These amounts entered transfer authorization and have not completed it yet.' : 'These amounts have completed authorization or have a saved pending request.'}</p></div><strong>{visible ? money(view === 'processing' ? totals.processing : totals.pending) : '••••'}</strong></div>
        {statusItems.map((item) => <TransactionRow key={item.id} item={item} />)}
        {!statusItems.length && <div className="transfer-status-empty"><Clock3 size={28} /><strong>No {view} transfers.</strong><p>Your {view} transfers will appear here.</p><button className="button button--green" type="button" onClick={() => navigate('/dashboard/withdraw')}>Start a transfer<ArrowUpRight size={16} /></button></div>}
      </section>}

      {view === 'activity' && <section className="dashboard-card activity-full"><div className="section-line"><div><span>TRANSACTION HISTORY</span><h2>Every movement.</h2></div><label className="activity-search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search activity" aria-label="Search transactions" /></label></div>{filtered.map((item) => <TransactionRow key={item.id} item={item} />)}{!filtered.length && <p className="empty-copy">No transactions match your search.</p>}</section>}
    </AppShell>
  )
}
