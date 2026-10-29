import { useEffect, useState } from 'react'
import { Check, Copy, KeyRound, RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { ButtonLoader } from './Loader'
import { useToast } from '../context/ToastContext'

const money = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0))
const dateTime = (value) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value))

export const codeDetails = [
  { name: 'Identity Verification', purpose: 'Confirms that the member authorizes this transfer from their own account.' },
  { name: 'Recipient Confirmation', purpose: 'Confirms that the saved recipient details are correct and approved by the member.' },
  { name: 'Security Authorization', purpose: 'Adds a security check before the transfer can be prepared for review.' },
  { name: 'Transfer Release', purpose: 'Confirms final approval to submit the transfer for administrative processing.' },
]

export default function SerialCodeManager({ memberId, method, methodName, metadata, onReset }) {
  const { showToast } = useToast()
  const [amounts, setAmounts] = useState(['', '', '', ''])
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  const [copiedAll, setCopiedAll] = useState(false)
  const [copiedSlot, setCopiedSlot] = useState(0)
  const fail = (message) => { setError(message); showToast(message, 'error') }

  useEffect(() => {
    if (metadata.length === 4) setAmounts(metadata.slice(0, 4).map((item) => Number(item.amount).toFixed(2)))
  }, [metadata])

  const total = amounts.reduce((sum, value) => sum + (Number(value) || 0), 0)

  const generate = async (event) => {
    event.preventDefault()
    const numeric = amounts.map(Number)
    if (numeric.some((value) => !Number.isFinite(value) || value <= 0 || value > 999999999999.99)) {
      fail('Enter a valid amount greater than zero for every authorization.')
      return
    }
    if (metadata.length && !window.confirm(`Reset the ${methodName} codes and fees? Paid codes will become unpaid and this method’s member progress will restart from the first authorization. Other methods will not change.`)) return
    setProcessing(true)
    setError('')
    setCopiedAll(false)
    setCopiedSlot(0)
    try {
      const { data, error: resetError } = await supabase.rpc('admin_reset_member_serial_codes', {
        p_user_id: memberId,
        p_method: method,
        p_amounts: numeric,
      })
      if (resetError) fail(resetError.message)
      else {
        onReset(data || [])
        showToast(`${methodName} codes and fees saved.`, 'success')
      }
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
      showToast(slot ? `Authorization code ${slot} copied.` : 'All authorization codes copied.', 'success')
    } catch {
      fail('Copying is unavailable. Select and copy the codes manually.')
    }
  }

  const savedCodes = metadata.filter((item) => item.code)
  const copyCodes = () => copyText(savedCodes.map((item) => `Code ${item.slot}: ${item.code} — Fee ${money(item.amount)} — ${item.code_name} — ${item.code_purpose}`).join('\n'))

  return (
    <section className="admin-panel member-tool member-code-tool">
      <div className="card-heading"><div><span>{methodName.toUpperCase()} · MEMBER AUTHORIZATION</span><h2>Codes and fee amounts</h2><p>These codes, fees, and paid states belong only to this member’s {methodName} transfer. Regenerating them restarts this method from the first unpaid authorization.</p></div><KeyRound size={22} /></div>
      {error && <p className="member-tool-error" role="alert">{error}</p>}
      <form onSubmit={generate}>
        <div className="code-amount-grid">{amounts.map((value, index) => <label key={codeDetails[index].name}><span>Code {index + 1} fee</span><div className="code-amount-input"><span>$</span><input type="number" min="0.01" max="999999999999.99" step="0.01" value={value} onChange={(event) => setAmounts((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} required /></div><small className="code-fee-name">{codeDetails[index].name}</small><small className="code-fee-reason">{codeDetails[index].purpose}</small></label>)}</div>
        <div className="code-total"><span>Total authorization fees<small>Four separate fees · not added to the transfer amount</small></span><strong>{money(total)}</strong></div>
        <button className="button button--green" type="submit" disabled={processing}>{processing ? <ButtonLoader label="Generating" /> : <><RefreshCw size={16} />{metadata.length ? 'Reset codes & fees' : 'Generate codes & fees'}</>}</button>
      </form>
      {metadata.length > 0 && <div className="generated-codes"><div><span>SAVED {methodName.toUpperCase()} CODE SET</span>{savedCodes.length > 0 && <button type="button" onClick={copyCodes}>{copiedAll ? <Check size={15} /> : <Copy size={15} />}{copiedAll ? 'Copied all' : 'Copy all'}</button>}</div><p>Saved in Supabase for this member and method. Only administrators can retrieve these codes.</p><ol>{metadata.map((item) => <li key={item.slot}><div className="generated-code-heading"><span>Code {item.slot} · {item.code_name}</span><button type="button" onClick={() => copyText(item.code, item.slot)} disabled={!item.code} aria-label={`Copy authorization code ${item.slot}`}>{copiedSlot === item.slot ? <Check size={14} /> : <Copy size={14} />}{copiedSlot === item.slot ? 'Copied' : 'Copy code'}</button></div><strong>{item.code || 'Legacy code unavailable'}</strong><small>{money(item.amount)} fee · {item.paid_at ? `Paid ${dateTime(item.paid_at)}` : 'Unpaid'}{item.used_at ? ` · Used ${dateTime(item.used_at)}` : ''}</small><p>{item.code_purpose}</p>{!item.code && <p>Reset this set once to save retrievable codes.</p>}</li>)}</ol></div>}
    </section>
  )
}
