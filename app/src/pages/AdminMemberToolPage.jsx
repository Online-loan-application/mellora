import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { Link, useParams } from 'react-router'
import AppShell from '../components/AppShell'
import Loader, { ButtonLoader } from '../components/Loader'
import SetupNotice from '../components/SetupNotice'
import ReceiptManager from '../components/ReceiptManager'
import { BalanceManager, DepositSettings, MemberActivity, NotificationManager } from '../components/AdminMemberTools'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { supabase } from '../lib/supabase'

const pages = {
  deposit: { title: 'Deposit settings', eyebrow: 'INDIVIDUAL DEPOSIT SETTINGS' },
  balances: { title: 'Account balances', eyebrow: 'INDIVIDUAL ACCOUNT BALANCES' },
  notifications: { title: 'Notifications', eyebrow: 'INDIVIDUAL NOTIFICATIONS' },
  activity: { title: 'Member activity', eyebrow: 'INDIVIDUAL MEMBER ACTIVITY' },
}
const emptyDeposit = { bank_name: '', bank_branch: '', account_name: '', account_number: '', routing_number: '', account_type: '', instructions: '' }

export default function AdminMemberToolPage({ tool }) {
  const { userId } = useParams()
  const { user: admin } = useAuth()
  const { showToast } = useToast()
  const [member, setMember] = useState(null)
  const [data, setData] = useState(tool === 'deposit' ? null : [])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const page = pages[tool]

  const loadData = useCallback(async (quiet = false) => {
    quiet ? setRefreshing(true) : setLoading(true)
    const profileRequest = supabase.from('profiles').select('id, full_name, email, role, created_at').eq('id', userId).maybeSingle()
    let toolRequest
    if (tool === 'deposit') toolRequest = supabase.from('member_deposit_settings').select('*').eq('user_id', userId).limit(1)
    else if (tool === 'balances') toolRequest = supabase.from('accounts').select('id, user_id, name, type, balance, last4').eq('user_id', userId).order('created_at')
    else if (tool === 'notifications') toolRequest = supabase.from('notifications').select('id, title, message, read_at, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(100)
    else toolRequest = supabase.from('member_activities').select('id, type, metadata, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(100)
    const [profileResult, toolResult] = await Promise.all([profileRequest, toolRequest])
    const failure = profileResult.error || toolResult.error
    if (failure) setError(failure.message)
    else {
      setMember(profileResult.data)
      setData(tool === 'deposit' ? toolResult.data?.[0] || { user_id: userId, ...emptyDeposit } : toolResult.data || [])
      setError('')
      if (quiet) showToast(`${page.title} refreshed.`, 'success')
    }
    setLoading(false)
    setRefreshing(false)
  }, [userId, tool, page.title, showToast])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => { if (error) showToast(error, 'error') }, [error, showToast])

  if (loading) return <Loader fullScreen label={`Loading ${page.title.toLowerCase()}`} />
  if (!member) return <AppShell title="Member not found" eyebrow="MELLORA ADMINISTRATION"><Link className="payment-back" to="/admin"><ArrowLeft size={17} />Back to members</Link><SetupNotice message={error || 'This member profile does not exist.'} /></AppShell>

  return (
    <AppShell title={page.title} eyebrow={member.full_name} actions={<button className="icon-action" type="button" onClick={() => loadData(true)} disabled={refreshing} aria-label={`Refresh ${page.title.toLowerCase()}`}>{refreshing ? <ButtonLoader label="" /> : <RefreshCw size={18} />}</button>}>
      <Link className="payment-back" to={`/admin/members/${userId}`}><ArrowLeft size={17} />Back to {member.full_name}</Link>
      {error && <SetupNotice message={error} />}
      <div className="member-tool-page">
        {tool === 'deposit' && <><DepositSettings memberId={userId} adminId={admin.id} value={data} onSaved={setData} /><ReceiptManager memberId={userId} adminId={admin.id} memberName={member.full_name} /></>}
        {tool === 'balances' && <BalanceManager accounts={data} onUpdated={(account, balance) => setData((items) => items.map((item) => item.id === account.id ? { ...item, balance } : item))} />}
        {tool === 'notifications' && <NotificationManager member={member} adminId={admin.id} notifications={data} onSent={(payload) => setData((items) => [{ ...payload, id: `local-${Date.now()}`, created_at: new Date().toISOString(), read_at: null }, ...items])} />}
        {tool === 'activity' && <MemberActivity activities={data} />}
      </div>
    </AppShell>
  )
}
