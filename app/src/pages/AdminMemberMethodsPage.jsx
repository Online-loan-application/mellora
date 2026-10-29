import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, ChevronRight, KeyRound, RefreshCw } from 'lucide-react'
import { Link, useParams } from 'react-router'
import AppShell from '../components/AppShell'
import Loader, { ButtonLoader } from '../components/Loader'
import SetupNotice from '../components/SetupNotice'
import { useToast } from '../context/ToastContext'
import { getTransferMethod } from '../lib/transferMethods'
import { supabase } from '../lib/supabase'

const money = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0))

export default function AdminMemberMethodsPage() {
  const { userId } = useParams()
  const { showToast } = useToast()
  const [member, setMember] = useState(null)
  const [drafts, setDrafts] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const loadData = useCallback(async (quiet = false) => {
    quiet ? setRefreshing(true) : setLoading(true)
    const [profileResult, draftResult] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email').eq('id', userId).maybeSingle(),
      supabase.from('member_transfer_drafts').select('method, amount, confirmed_codes, authorization_started_at, created_at, updated_at').eq('user_id', userId).order('updated_at', { ascending: false }),
    ])
    const failure = profileResult.error || draftResult.error
    if (failure) setError(failure.message)
    else {
      setMember(profileResult.data)
      setDrafts(draftResult.data || [])
      setError('')
      if (quiet) showToast('Transfer methods refreshed.', 'success')
    }
    setLoading(false)
    setRefreshing(false)
  }, [userId, showToast])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => { if (error) showToast(error, 'error') }, [error, showToast])

  if (loading) return <Loader fullScreen label="Loading previewed transfer methods" />

  return (
    <AppShell title="Transfer authorization" eyebrow={member?.full_name || 'INDIVIDUAL MEMBER MANAGEMENT'} actions={<button className="icon-action" type="button" onClick={() => loadData(true)} disabled={refreshing} aria-label="Refresh transfer methods">{refreshing ? <ButtonLoader label="" /> : <RefreshCw size={18} />}</button>}>
      <Link className="payment-back" to={`/admin/members/${userId}`}><ArrowLeft size={17} />Back to {member?.full_name || 'member'}</Link>
      {error && <SetupNotice message={error} />}
      <section className="admin-panel member-tool member-transfer-methods" aria-labelledby="previewed-methods-title">
        <div className="card-heading"><div><span>PREVIEWED TRANSFER METHODS</span><h2 id="previewed-methods-title">Method authorization</h2><p>A section appears only after this member previews that payment method. Open a method to generate its own codes and fee amounts.</p></div><KeyRound size={22} /></div>
        <div className="member-method-list">
          {drafts.map((draft) => {
            const method = getTransferMethod(draft.method)
            if (!method) return null
            const MethodIcon = method.icon
            const confirmations = Array.isArray(draft.confirmed_codes) ? draft.confirmed_codes.filter(Boolean).length : 0
            const status = !draft.authorization_started_at ? 'Previewed' : confirmations === 4 ? 'Authorization complete' : 'Processing'
            return <Link className="member-method-link" key={draft.method} to={`/admin/members/${userId}/methods/${draft.method}`}><span className="member-method-link__icon"><MethodIcon size={20} /></span><span className="member-method-link__copy"><strong>{method.name}</strong><small>{money(draft.amount)} · {status}</small></span><span className="member-method-link__progress">{draft.authorization_started_at ? `${confirmations} of 4 confirmed` : 'Awaiting codes'}<ChevronRight size={17} /></span></Link>
          })}
          {!drafts.length && <div className="member-method-empty"><strong>No transfer methods previewed yet.</strong><p>Methods will appear here individually after the member reaches a transfer preview.</p></div>}
        </div>
      </section>
    </AppShell>
  )
}
