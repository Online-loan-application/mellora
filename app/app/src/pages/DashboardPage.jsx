import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowDownLeft, ArrowUpRight, Clock3, Eye, EyeOff, RefreshCw, Search, WalletCards } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { trackActivity, trackDepositClick } from '../lib/activity'
import AppShell from '../components/AppShell'
import NotificationCenter from '../components/NotificationCenter'
import Loader, { ButtonLoader } from '../components/Loader'
import SetupNotice from '../components/SetupNotice'

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

export default function DashboardPage() {
  const { user, profile, profileError } = useAuth()
  const [accounts, setAccounts] = useState([])
  const [transactions, setTransactions] = useState([])
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [view, setView] = useState('overview')
  const [visible, setVisible] = useState(true)
  const [query, setQuery] = useState('')
  const [now, setNow] = useState(() => new Date())
  const navigate = useNavigate()

  const loadData = useCallback(async (quiet = false) => {
    if (!user) return
    quiet ? setRefreshing(true) : setLoading(true)
    const [accountResult, transactionResult, notificationResult] = await Promise.all([
      supabase.from('accounts').select('*').eq('user_id', user.id).order('created_at'),
      supabase.from('transactions').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
      supabase.from('notifications').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
    ])
    const failure = accountResult.error || transactionResult.error || notificationResult.error
    if (failure) setError(failure.message)
    else {
      setAccounts(accountResult.data || [])
      setTransactions(transactionResult.data || [])
      setNotifications(notificationResult.data || [])
      setError('')
    }
    setLoading(false)
    setRefreshing(false)
  }, [user])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const totals = useMemo(() => ({
    balance: accounts.reduce((sum, item) => sum + Number(item.balance), 0),
    income: transactions.filter((item) => Number(item.amount) > 0).reduce((sum, item) => sum + Number(item.amount), 0),
    spending: Math.abs(transactions.filter((item) => Number(item.amount) < 0).reduce((sum, item) => sum + Number(item.amount), 0)),
  }), [accounts, transactions])
  const filtered = transactions.filter((item) => `${item.merchant} ${item.category}`.toLowerCase().includes(query.toLowerCase()))
  const firstName = (profile?.full_name || user?.email?.split('@')[0] || 'there').split(' ')[0]
  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  if (loading) return <Loader fullScreen label="Opening your mellow dashboard" />

  return (
    <AppShell title={`${greeting}, ${firstName}.`} eyebrow="YOUR FINANCIAL OVERVIEW" actions={<><NotificationCenter notifications={notifications} setNotifications={setNotifications} /><button className="icon-action" type="button" onClick={() => loadData(true)} disabled={refreshing} aria-label="Refresh dashboard">{refreshing ? <ButtonLoader label="" /> : <RefreshCw size={18} />}</button></>}>
      {(error || profileError) && <SetupNotice message={error || profileError} />}
      <div className="dashboard-tabs" role="tablist" aria-label="Dashboard views">{['overview', 'accounts', 'activity'].map((item) => <button key={item} role="tab" aria-selected={view === item} className={view === item ? 'active' : ''} onClick={() => setView(item)}>{item === 'overview' ? 'Overview' : item === 'accounts' ? 'My accounts' : 'Activity'}</button>)}</div>
      <div className="dashboard-datetime" aria-label={`Local date and time: ${fullDate(now)}, ${localTime(now)}`}>
        <Clock3 size={20} />
        <div><span>YOUR LOCAL TIME</span><strong>{localTime(now)}</strong></div>
        <p>{fullDate(now)}</p>
      </div>
      {view === 'overview' && <>
        <section className="balance-hero">
          <div className="balance-hero__top"><span>TOTAL BALANCE</span><button type="button" onClick={() => setVisible(!visible)} aria-label={visible ? 'Hide balances' : 'Show balances'}>{visible ? <Eye size={18} /> : <EyeOff size={18} />}</button></div>
          <strong>{visible ? money(totals.balance) : '••••••••'}</strong>
          <p><span><i /> Live from Supabase</span> across {accounts.length} accounts</p>
          <div className="balance-hero__stats"><div><span>Money in</span><strong>{visible ? money(totals.income) : '••••'}</strong></div><div><span>Money out</span><strong>{visible ? money(totals.spending) : '••••'}</strong></div></div>
          <div className="balance-actions"><button type="button" onClick={() => { trackDepositClick(); navigate('/dashboard/deposit') }}><ArrowDownLeft size={17} />Deposit</button><button type="button" onClick={() => { trackActivity('withdrawal_started'); navigate('/dashboard/withdraw') }} disabled={!accounts.length}><ArrowUpRight size={17} />Transfer</button></div>
          <div className="balance-orb" aria-hidden="true"><i /><i /><span /></div>
        </section>
        <div className="dashboard-grid">
          <section className="dashboard-card cashflow-card"><div className="card-heading"><div><span>CASH FLOW</span><h2>Your week in motion</h2></div><small>Last 7 days</small></div><CashflowChart transactions={transactions} /></section>
          <section className="dashboard-card accounts-card"><div className="card-heading"><div><span>ACCOUNTS</span><h2>Your pockets</h2></div><WalletCards size={20} /></div>{accounts.map((account, index) => <div className="account-mini" key={account.id}><span className={`account-mini__icon account-mini__icon--${index % 2}`}><WalletCards size={19} /></span><div><strong>{account.name}</strong><small>•• {account.last4}</small></div><b>{visible ? money(account.balance) : '••••'}</b></div>)}{!accounts.length && !error && <p className="empty-copy">No accounts yet. New profiles receive sample accounts after the schema trigger is installed.</p>}</section>
        </div>
        <section className="dashboard-card recent-card"><div className="card-heading"><div><span>RECENT ACTIVITY</span><h2>Latest transactions</h2></div><button type="button" onClick={() => setView('activity')}>View all <ArrowUpRight size={16} /></button></div>{transactions.slice(0, 5).map((item) => <TransactionRow key={item.id} item={item} />)}{!transactions.length && !error && <p className="empty-copy">Your transaction activity will appear here.</p>}</section>
      </>}

      {view === 'accounts' && <section className="accounts-full"><div className="section-line"><div><span>YOUR ACCOUNTS</span><h2>Every balance, one view.</h2></div><button className="icon-action" type="button" onClick={() => setVisible(!visible)}>{visible ? <Eye size={18} /> : <EyeOff size={18} />}</button></div><div className="account-card-grid">{accounts.map((account, index) => <article className={`account-full-card account-full-card--${index % 2}`} key={account.id}><div><span>{account.type}</span><small>•••• {account.last4}</small></div><h3>{account.name}</h3><strong>{visible ? money(account.balance) : '••••••'}</strong><p>{account.currency} · Available balance</p><div className="account-card-lines"><i /><i /><i /></div></article>)}</div></section>}

      {view === 'activity' && <section className="dashboard-card activity-full"><div className="section-line"><div><span>TRANSACTION HISTORY</span><h2>Every movement.</h2></div><label className="activity-search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search activity" aria-label="Search transactions" /></label></div>{filtered.map((item) => <TransactionRow key={item.id} item={item} />)}{!filtered.length && <p className="empty-copy">No transactions match your search.</p>}</section>}
    </AppShell>
  )
}
