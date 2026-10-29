import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, CheckCircle2, Clock3, KeyRound, RefreshCw, ShieldCheck } from 'lucide-react'
import { Link, useParams } from 'react-router'
import AppShell from '../components/AppShell'
import Loader, { ButtonLoader } from '../components/Loader'
import SerialCodeManager, { codeDetails } from '../components/SerialCodeManager'
import SetupNotice from '../components/SetupNotice'
import { getTransferMethod } from '../lib/transferMethods'
import { supabase } from '../lib/supabase'
import { useToast } from '../context/ToastContext'

const money = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0))
const dateTime = (value) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
const draftFields = 'method, amount, serial_step, confirmed_codes, next_code_available_at, authorization_started_at, created_at, updated_at'

export default function AdminMethodPage() {
  const { userId, method } = useParams()
  const methodConfig = getTransferMethod(method)
  const { showToast } = useToast()
  const [member, setMember] = useState(null)
  const [draft, setDraft] = useState(null)
  const [codeMetadata, setCodeMetadata] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadData = useCallback(async (quiet = false) => {
    if (!methodConfig) {
      setError('This transfer method is not supported.')
      setLoading(false)
      return
    }
    quiet ? setRefreshing(true) : setLoading(true)
    const [profileResult, draftResult] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email').eq('id', userId).maybeSingle(),
      supabase.from('member_transfer_drafts').select(draftFields).eq('user_id', userId).eq('method', method).maybeSingle(),
    ])
    const failure = profileResult.error || draftResult.error
    if (failure) {
      setError(failure.message)
    } else {
      setMember(profileResult.data)
      setDraft(draftResult.data)
      if (draftResult.data) {
        const { data, error: codeError } = await supabase.rpc('admin_get_member_serial_codes', {
          p_user_id: userId,
          p_method: method,
        })
        if (codeError) setError(codeError.message)
        else {
          setCodeMetadata(data || [])
          setError('')
          if (quiet) showToast('Transfer authorization refreshed.', 'success')
        }
      } else {
        setCodeMetadata([])
        setError('')
        if (quiet) showToast('Transfer authorization refreshed.', 'success')
      }
    }
    setLoading(false)
    setRefreshing(false)
  }, [userId, method, methodConfig, showToast])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => { if (error) showToast(error, 'error') }, [error, showToast])
  useEffect(() => { if (notice) showToast(notice, 'success') }, [notice, showToast])

  if (loading) return <Loader fullScreen label="Loading transfer authorization" />
  if (!methodConfig) return <AppShell title="Transfer method not found" eyebrow="MELLORA ADMINISTRATION"><Link className="payment-back" to={`/admin/members/${userId}`}><ArrowLeft size={17} />Back to member</Link><SetupNotice message={error} /></AppShell>

  const MethodIcon = methodConfig.icon
  const confirmations = Array.isArray(draft?.confirmed_codes) ? draft.confirmed_codes.filter(Boolean).length : 0
  const status = !draft?.authorization_started_at ? 'Previewed' : confirmations === 4 ? 'Authorization complete' : 'Processing'

  return (
    <AppShell title={`${methodConfig.name} authorization`} eyebrow={member?.full_name || 'INDIVIDUAL MEMBER MANAGEMENT'} actions={<button className="icon-action" type="button" onClick={() => loadData(true)} disabled={refreshing} aria-label="Refresh method authorization">{refreshing ? <ButtonLoader label="" /> : <RefreshCw size={18} />}</button>}>
      <Link className="payment-back" to={`/admin/members/${userId}`}><ArrowLeft size={17} />Back to {member?.full_name || 'member'}</Link>
      {error && <SetupNotice message={error} />}
      {notice && <div className="admin-notice" role="status"><CheckCircle2 size={18} />{notice}</div>}

      {!draft ? (
        <section className="admin-panel method-admin-empty">
          <KeyRound size={28} />
          <h2>No previewed {methodConfig.name} transfer.</h2>
          <p>This administration page becomes available after the member previews a transfer with this method.</p>
        </section>
      ) : (
        <>
          <section className="member-profile-header method-admin-header">
            <div className="member-profile-identity"><span><MethodIcon size={25} /></span><div><small>PREVIEWED TRANSFER METHOD</small><h2>{methodConfig.name}</h2><p>{member?.full_name} · {member?.email}</p></div></div>
            <dl><div><dt>Transfer amount</dt><dd>{money(draft.amount)}</dd></div><div><dt>Member status</dt><dd>{status}</dd></div><div><dt>Confirmations</dt><dd>{confirmations} of 4</dd></div><div><dt>Last preview or update</dt><dd>{dateTime(draft.updated_at || draft.created_at)}</dd></div></dl>
          </section>

          <div className="method-admin-grid">
            <SerialCodeManager memberId={userId} method={method} methodName={methodConfig.name} metadata={codeMetadata} onReset={(codes) => {
              setCodeMetadata(codes.map((item) => ({ ...item, created_at: new Date().toISOString(), paid_at: null, used_at: null })))
              setDraft((current) => ({ ...current, serial_step: 0, confirmed_codes: [false, false, false, false], next_code_available_at: null, updated_at: new Date().toISOString() }))
              setNotice(`${methodConfig.name} codes were regenerated. Member progress now restarts from the first authorization; other methods are unchanged.`)
            }} />
            <aside className="admin-panel member-tool method-sequence-panel">
              <div className="card-heading"><div><span>STRICT SEQUENCE</span><h2>One paid step at a time.</h2><p>The member cannot open a later authorization until every previous {methodConfig.name} authorization is paid.</p></div><ShieldCheck size={22} /></div>
              <ol>{codeDetails.map((item, index) => {
                const saved = codeMetadata.find((code) => Number(code.slot) === index + 1)
                return <li key={item.name}><span>{saved?.paid_at ? <CheckCircle2 size={16} /> : <Clock3 size={16} />}</span><div><strong>{item.name}</strong><small>{saved ? `${money(saved.amount)} · ${saved.paid_at ? 'Paid' : 'Unpaid'}` : 'Fee not generated'}</small></div></li>
              })}</ol>
              <p className="method-reset-note">Resetting codes and fees marks all four unpaid and clears only this method’s saved confirmations and security-review timer.</p>
            </aside>
          </div>
        </>
      )}
    </AppShell>
  )
}
