import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Info, Landmark, RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import PaymentFlowLayout from '../components/PaymentFlowLayout'
import DepositReceipt from '../components/DepositReceipt'
import Loader, { ButtonLoader } from '../components/Loader'

const emptySettings = {
  bank_name: '', bank_branch: '', account_name: '', account_number: '', routing_number: '', account_type: '', instructions: '',
}

export default function DepositPage() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const [settings, setSettings] = useState(emptySettings)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')
  const [receiptStatus, setReceiptStatus] = useState('')

  const loadSettings = useCallback(async (quiet = false) => {
    quiet ? setRefreshing(true) : setLoading(true)
    setError('')
    try {
      const { data, error: settingsError } = await supabase
        .from('member_deposit_settings')
        .select('bank_name, bank_branch, account_name, account_number, routing_number, account_type, instructions, updated_at')
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
  useEffect(() => {
    if (error) showToast(error, 'error')
  }, [error, showToast])

  const copyText = async (label, value) => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(label)
      showToast(`${label} copied to your clipboard.`, 'success')
      window.setTimeout(() => setCopied(''), 1800)
    } catch {
      setError('Copying is unavailable in this browser. Select the account detail and copy it manually.')
    }
  }

  const configured = Boolean(settings.bank_name && settings.account_name && settings.account_number)
  const receiptConfirming = receiptStatus === 'confirming'
  const detailRows = [
    ['Bank name', settings.bank_name],
    ['Bank branch', settings.bank_branch],
    ['Account name', settings.account_name],
    ['Account type', settings.account_type],
    ['Account number', settings.account_number],
    ['Routing number', settings.routing_number],
  ]

  return (
    <PaymentFlowLayout title={receiptConfirming ? 'Receipt confirmation' : 'Deposit instructions'} eyebrow="PAYMENT DETAILS">
      {loading ? <section className="payment-panel deposit-panel"><Loader label="Loading deposit instructions" /></section> : !configured ? (
        <section className="payment-panel deposit-panel deposit-panel--empty" aria-labelledby="deposit-title">
          <div className="payment-panel__heading">
            <div><span>ADMIN-PROVIDED DETAILS</span><h2 id="deposit-title">Deposit instructions</h2></div>
            <button className="icon-action" type="button" onClick={() => loadSettings(true)} disabled={refreshing} aria-label="Refresh deposit instructions">{refreshing ? <ButtonLoader label="" /> : <RefreshCw size={18} />}</button>
          </div>
          {error && <p className="member-tool-error" role="alert">{error}</p>}
          <div className="deposit-empty-state">
            <Landmark size={28} />
            <strong>Nothing to show yet.</strong>
            <p>Your administrator has not configured your deposit account details. Please check again after they have been added.</p>
          </div>
        </section>
      ) : <>
        {!receiptConfirming && <section className="payment-panel deposit-panel" aria-labelledby="deposit-title">
          <div className="payment-panel__heading">
            <div><span>ADMIN-PROVIDED DETAILS</span><h2 id="deposit-title">Make your payment.</h2><p>Use the bank details and instructions below. Your balance will not increase automatically.</p></div>
            <button className="icon-action" type="button" onClick={() => loadSettings(true)} disabled={refreshing} aria-label="Refresh deposit instructions">{refreshing ? <ButtonLoader label="" /> : <RefreshCw size={18} />}</button>
          </div>

          <div className="deposit-account-card">
            <div className="deposit-account-card__title"><Landmark size={22} /><div><span>RECIPIENT ACCOUNT</span><h3>Payment account details</h3></div></div>
            <dl>
              {detailRows.map(([label, value]) => value && (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                  <button type="button" onClick={() => copyText(label, value)} aria-label={`Copy ${label.toLowerCase()}`}>
                    {copied === label ? <Check size={16} /> : <Copy size={16} />}{copied === label ? 'Copied' : 'Copy'}
                  </button>
                </div>
              ))}
            </dl>
          </div>

          {settings.instructions && <div className="deposit-instructions"><span>PAYMENT INSTRUCTIONS</span><p>{settings.instructions}</p></div>}
          <div className="payment-information"><Info size={19} /><p>Use these details exactly as provided. Submitting or viewing this page does not create a transaction or change your balance. An administrator must review and update the account after payment.</p></div>
        </section>}
        <DepositReceipt onStatusChange={setReceiptStatus} />
      </>}
    </PaymentFlowLayout>
  )
}
