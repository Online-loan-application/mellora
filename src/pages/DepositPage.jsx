import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Info, Landmark, RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import PaymentFlowLayout from '../components/PaymentFlowLayout'
import Loader, { ButtonLoader } from '../components/Loader'
import SetupNotice from '../components/SetupNotice'

const money = (value) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(Number(value || 0))

const emptySettings = {
  bank_name: '', bank_branch: '', account_name: '', account_number: '', routing_number: '', account_type: '',
  amount: 0, reason: '', instructions: '',
}

export default function DepositPage() {
  const { user } = useAuth()
  const [settings, setSettings] = useState(emptySettings)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')

  const loadSettings = useCallback(async (quiet = false) => {
    quiet ? setRefreshing(true) : setLoading(true)
    setError('')
    try {
      const { data, error: settingsError } = await supabase
        .from('member_deposit_settings')
        .select('bank_name, bank_branch, account_name, account_number, routing_number, account_type, amount, reason, instructions, updated_at')
        .eq('user_id', user.id)
        .limit(1)
      if (settingsError) setError(settingsError.message)
      else setSettings({ ...emptySettings, ...(data?.[0] || {}) })
    } catch (requestError) {
      setError(requestError.message || 'Deposit instructions could not be loaded.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [user])

  useEffect(() => { loadSettings() }, [loadSettings])

  const copyText = async (label, value) => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(label)
      window.setTimeout(() => setCopied(''), 1800)
    } catch {
      setError('Copying is unavailable in this browser. Select the account detail and copy it manually.')
    }
  }

  const configured = Boolean(settings.account_number && Number(settings.amount) > 0)
  const detailRows = [
    ['Bank name', settings.bank_name],
    ['Bank branch', settings.bank_branch],
    ['Account name', settings.account_name],
    ['Account type', settings.account_type],
    ['Account number', settings.account_number],
    ['Routing number', settings.routing_number],
  ]

  return (
    <PaymentFlowLayout title="Deposit instructions" eyebrow="PAYMENT DETAILS">
      <section className="payment-panel deposit-panel" aria-labelledby="deposit-title">
        <div className="payment-panel__heading">
          <div><span>ADMIN-PROVIDED DETAILS</span><h2 id="deposit-title">Make your payment.</h2><p>Use the account details and payment context below. Your balance will not increase automatically.</p></div>
          <button className="icon-action" type="button" onClick={() => loadSettings(true)} disabled={refreshing} aria-label="Refresh deposit instructions">{refreshing ? <ButtonLoader label="" /> : <RefreshCw size={18} />}</button>
        </div>

        {error && <SetupNotice message={error} />}
        {loading ? <Loader label="Loading deposit instructions" /> : (
          <>
            <div className="deposit-purpose">
              <div><span>PAYMENT CONTEXT</span><h3>{settings.reason || 'Payment context has not been configured.'}</h3></div>
              <div className="deposit-required-amount"><span>REQUIRED AMOUNT</span><strong>{Number(settings.amount) > 0 ? money(settings.amount) : 'Not configured'}</strong></div>
            </div>

            <div className="deposit-account-card">
              <div className="deposit-account-card__title"><Landmark size={22} /><div><span>RECIPIENT ACCOUNT</span><h3>Payment account details</h3></div></div>
              <dl>
                {detailRows.map(([label, value]) => (
                  <div key={label} className={!value ? 'not-configured' : ''}>
                    <dt>{label}</dt>
                    <dd>{value || 'Not configured'}</dd>
                    <button type="button" onClick={() => copyText(label, value)} disabled={!value} aria-label={`Copy ${label.toLowerCase()}`}>
                      {copied === label ? <Check size={16} /> : <Copy size={16} />}{copied === label ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                ))}
              </dl>
            </div>

            {settings.instructions && <div className="deposit-instructions"><span>PAYMENT INSTRUCTIONS</span><p>{settings.instructions}</p></div>}
            <div className="payment-information"><Info size={19} /><p>{configured ? 'Use these details exactly as provided. Submitting or viewing this page does not create a transaction or change your balance. An administrator must review and update the account after payment.' : 'An administrator needs to configure the required amount and recipient account before these instructions can be used.'}</p></div>
          </>
        )}
      </section>
    </PaymentFlowLayout>
  )
}
