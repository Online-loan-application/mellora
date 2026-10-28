import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, CheckCircle2, CircleAlert, KeyRound, Landmark, LockKeyhole, Pencil, Plus, ShieldCheck, WalletCards } from 'lucide-react'
import { Link } from 'react-router'
import { supabase } from '../lib/supabase'
import { trackActivity } from '../lib/activity'
import { useAuth } from '../context/AuthContext'
import PaymentFlowLayout from '../components/PaymentFlowLayout'
import Loader, { ButtonLoader } from '../components/Loader'

const steps = ['Account', 'Amount', 'Preview', 'Serial codes']
const money = (value) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(Number(value || 0))
const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100
const emptyDetails = { account_holder: '', bank_name: '', account_number: '', routing_number: '' }
const emptyConfirmations = [false, false, false, false]
const accountFields = 'id, account_holder, bank_name, account_number, routing_number, created_at'

export default function WithdrawalPage() {
  const { user, profile } = useAuth()
  const [accounts, setAccounts] = useState([])
  const [savedAccounts, setSavedAccounts] = useState([])
  const [details, setDetails] = useState(emptyDetails)
  const [withdrawalAccountId, setWithdrawalAccountId] = useState('')
  const [accountId, setAccountId] = useState('')
  const [amount, setAmount] = useState('')
  const [step, setStep] = useState(0)
  const [agreed, setAgreed] = useState(false)
  const [serialCodes, setSerialCodes] = useState(['', '', '', ''])
  const [codeRequirements, setCodeRequirements] = useState([])
  const [serialStep, setSerialStep] = useState(0)
  const [confirmedCodes, setConfirmedCodes] = useState(emptyConfirmations)
  const [confirmationNotice, setConfirmationNotice] = useState('')
  const [requestId, setRequestId] = useState('')
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  const accountFormRef = useRef(null)

  const loadData = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setError('')
    try {
      const [accountResult, withdrawalResult, codeResult] = await Promise.all([
        supabase.from('accounts').select('id, name, balance, currency, last4').eq('user_id', user.id).order('created_at'),
        supabase.from('withdrawal_accounts').select(accountFields).eq('user_id', user.id).order('created_at', { ascending: false }),
        supabase.rpc('member_get_serial_code_requirements'),
      ])
      const failure = accountResult.error || withdrawalResult.error || codeResult.error
      if (failure) {
        setError(failure.message)
      } else {
        const nextAccounts = accountResult.data || []
        setAccounts(nextAccounts)
        setAccountId((current) => current || nextAccounts[0]?.id || '')
        setSavedAccounts(withdrawalResult.data || [])
        setCodeRequirements(codeResult.data || [])
        setDetails((current) => ({ ...current, account_holder: current.account_holder || profile?.full_name || '' }))
      }
    } catch (requestError) {
      setError(requestError.message || 'Your transfer details could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [user, profile?.full_name])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'smooth' }) }, [step, serialStep])

  const selectedAccount = useMemo(() => accounts.find((account) => account.id === accountId), [accounts, accountId])
  const roundedAmount = roundMoney(amount)
  const codeSetReady = codeRequirements.length === 4
  const feeTotal = roundMoney(codeRequirements.reduce((sum, item) => sum + Number(item.amount || 0), 0))
  const currentRequirement = codeRequirements.find((item) => Number(item.slot) === serialStep + 1)
  const currentConfirmed = Boolean(confirmedCodes[serialStep])
  const allConfirmed = confirmedCodes.every(Boolean)

  const updateDetail = (field, value) => setDetails((current) => ({ ...current, [field]: value }))

  const useSavedAccount = (account) => {
    setWithdrawalAccountId(account.id)
    setDetails({ account_holder: account.account_holder, bank_name: account.bank_name, account_number: account.account_number, routing_number: account.routing_number || '' })
    setError('')
    setStep(1)
  }

  const editSavedAccount = (account) => {
    setWithdrawalAccountId(account.id)
    setDetails({ account_holder: account.account_holder, bank_name: account.bank_name, account_number: account.account_number, routing_number: account.routing_number || '' })
    setError('')
    window.setTimeout(() => accountFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }

  const startNewAccount = () => {
    setWithdrawalAccountId('')
    setDetails({ ...emptyDetails, account_holder: profile?.full_name || '' })
    setError('')
  }

  const saveDetails = async (event) => {
    event.preventDefault()
    const cleaned = Object.fromEntries(Object.entries(details).map(([key, value]) => [key, value.trim()]))
    if (cleaned.account_holder.length < 2 || cleaned.bank_name.length < 2 || cleaned.account_number.length < 4) {
      setError('Enter the account holder, bank name, and a valid account number.')
      return
    }
    setProcessing(true)
    setError('')
    try {
      let query = supabase.from('withdrawal_accounts')
      if (withdrawalAccountId) {
        query = query.update({ ...cleaned, updated_at: new Date().toISOString() }).eq('id', withdrawalAccountId).eq('user_id', user.id)
      } else {
        query = query.insert({ user_id: user.id, ...cleaned })
      }
      const { data, error: saveError } = await query.select(accountFields).single()
      if (saveError) {
        setError(saveError.message)
      } else {
        setWithdrawalAccountId(data.id)
        setDetails({ account_holder: data.account_holder, bank_name: data.bank_name, account_number: data.account_number, routing_number: data.routing_number || '' })
        setSavedAccounts((current) => {
          const exists = current.some((item) => item.id === data.id)
          return exists ? current.map((item) => item.id === data.id ? data : item) : [data, ...current]
        })
        trackActivity('withdrawal_details_saved')
        setStep(1)
      }
    } catch (requestError) {
      setError(requestError.message || 'Your recipient account could not be saved.')
    } finally {
      setProcessing(false)
    }
  }

  const continueFromAmount = (event) => {
    event.preventDefault()
    if (!accountId || !Number.isFinite(Number(amount)) || roundedAmount <= 0) {
      setError('Choose a funding account and enter an amount greater than zero.')
      return
    }
    if (roundedAmount > Number(selectedAccount?.balance || 0)) {
      setError(`This transfer exceeds the available balance of ${money(selectedAccount?.balance)}.`)
      return
    }
    setError('')
    trackActivity('withdrawal_amount_entered', { amount: roundedAmount })
    trackActivity('withdrawal_previewed', { amount: roundedAmount })
    setStep(2)
  }

  const updateSerialCode = (value) => {
    const cleaned = value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 12)
    setSerialCodes((current) => current.map((code, index) => index === serialStep ? cleaned : code))
    setError('')
    setConfirmationNotice('')
  }

  const verifyCurrentCode = async (event) => {
    event.preventDefault()
    const code = serialCodes[serialStep]
    if (!/^[A-Z0-9]{4,12}$/.test(code)) {
      setError(`Enter 4 to 12 letters or numbers for serial code ${serialStep + 1}.`)
      return
    }
    setProcessing(true)
    setError('')
    setConfirmationNotice('')
    try {
      const { data, error: verificationError } = await supabase.rpc('verify_member_serial_code', {
        p_slot: serialStep + 1,
        p_code: code,
      })
      if (verificationError) {
        setError(verificationError.message)
      } else {
        const verified = data?.[0]
        if (verified) {
          setCodeRequirements((current) => current.map((item) => Number(item.slot) === Number(verified.slot) ? verified : item))
        }
        setConfirmedCodes((current) => current.map((confirmed, index) => index === serialStep ? true : confirmed))
        setConfirmationNotice(`Serial code ${serialStep + 1} matched. Its fee of ${money(verified?.amount)} is now marked as paid.`)
      }
    } catch (verificationFailure) {
      setError(verificationFailure.message || 'The serial code could not be verified.')
    } finally {
      setProcessing(false)
    }
  }

  const submitRequest = async (event) => {
    event.preventDefault()
    if (!allConfirmed) {
      setError('Confirm each serial code in order before completing the transfer.')
      return
    }
    setProcessing(true)
    setError('')
    try {
      const { data, error: requestError } = await supabase.rpc('submit_withdrawal_request', {
        p_account_id: accountId,
        p_withdrawal_account_id: withdrawalAccountId,
        p_amount: roundedAmount,
      })
      if (requestError) {
        setError(requestError.message)
      } else {
        setRequestId(data)
        setSerialCodes(['', '', '', ''])
        setStep(4)
      }
    } catch (submissionError) {
      setError(submissionError.message || 'The transfer request could not be submitted.')
    } finally {
      setProcessing(false)
    }
  }

  const handleSerialSubmit = (event) => {
    if (currentConfirmed) {
      event.preventDefault()
      if (serialStep < 3) {
        const nextIndex = serialStep + 1
        setSerialStep(nextIndex)
        setConfirmationNotice(`Code ${serialStep + 1} is paid. Enter serial code ${nextIndex + 1}.`)
        setError('')
      } else {
        submitRequest(event)
      }
      return
    }
    verifyCurrentCode(event)
  }

  const startSerialVerification = () => {
    const paid = codeRequirements.map((item) => Boolean(item.paid_at))
    const firstUnpaid = paid.findIndex((item) => !item)
    setError('')
    setSerialCodes(['', '', '', ''])
    setConfirmedCodes(paid)
    setSerialStep(firstUnpaid === -1 ? 3 : firstUnpaid)
    setConfirmationNotice('')
    trackActivity('withdrawal_serial_codes_started', { amount: roundedAmount })
    setStep(3)
  }

  return (
    <PaymentFlowLayout title="Request a transfer" eyebrow="MEMBER TRANSFER" steps={steps} currentStep={step}>
      <section className="payment-panel withdrawal-panel" aria-labelledby="withdrawal-title">
        {error && <div className="payment-error" role="alert"><CircleAlert size={21} /><div><strong>We couldn’t continue</strong><p>{error}</p></div></div>}
        {loading ? <Loader label="Loading your saved recipient accounts" /> : (
          <>
            {step === 0 && (
              <div>
                <div className="payment-panel__heading"><div><span>STEP 1 · RECIPIENT ACCOUNT</span><h2 id="withdrawal-title">Where should it go?</h2><p>Choose one of your saved accounts first, or add a new recipient below.</p></div><Landmark size={26} /></div>
                <section className="saved-recipients" aria-labelledby="saved-recipients-title">
                  <div className="recipient-section-heading"><div><span>SAVED ACCOUNTS</span><h3 id="saved-recipients-title">Choose a recipient.</h3></div><small>{savedAccounts.length} saved</small></div>
                  <div className="saved-recipient-list">
                    {savedAccounts.map((account) => <article key={account.id}><div><strong>{account.account_holder}</strong><span>{account.bank_name}</span><small>Account ending in {account.account_number.slice(-4)}{account.routing_number ? ` · Routing ${account.routing_number}` : ''}</small></div><div><button type="button" onClick={() => editSavedAccount(account)}><Pencil size={14} />Edit</button><button type="button" onClick={() => useSavedAccount(account)}>Use account<ArrowRight size={14} /></button></div></article>)}
                    {!savedAccounts.length && <p className="empty-copy">No recipient accounts have been saved yet. Add your first account below.</p>}
                  </div>
                </section>
                <div className="recipient-account-form" ref={accountFormRef}>
                  <div className="recipient-section-heading"><div><span>{withdrawalAccountId ? 'EDIT SAVED ACCOUNT' : 'INPUT NEW ACCOUNT'}</span><h3>{withdrawalAccountId ? 'Update recipient details.' : 'Add a new recipient.'}</h3></div>{withdrawalAccountId && <button type="button" onClick={startNewAccount}><Plus size={15} />New account</button>}</div>
                  <form onSubmit={saveDetails}>
                    <div className="payment-form-grid">
                      <label className="payment-field payment-field--wide"><span>Account holder</span><input value={details.account_holder} onChange={(event) => updateDetail('account_holder', event.target.value)} maxLength="120" autoComplete="name" placeholder="Full name on the account" disabled={processing} required /></label>
                      <label className="payment-field payment-field--wide"><span>Bank name</span><input value={details.bank_name} onChange={(event) => updateDetail('bank_name', event.target.value)} maxLength="120" autoComplete="organization" placeholder="Recipient bank" disabled={processing} required /></label>
                      <label className="payment-field"><span>Account number</span><input value={details.account_number} onChange={(event) => updateDetail('account_number', event.target.value)} minLength="4" maxLength="34" autoComplete="off" placeholder="Account or IBAN number" disabled={processing} required /></label>
                      <label className="payment-field"><span>Routing number <small>Optional</small></span><input value={details.routing_number} onChange={(event) => updateDetail('routing_number', event.target.value)} maxLength="34" inputMode="numeric" autoComplete="off" placeholder="Sort code or routing number" disabled={processing} /></label>
                    </div>
                    <div className="payment-form-actions"><span>Saved securely to your member profile.</span><button className="button button--green" type="submit" disabled={processing || !accounts.length}>{processing ? <ButtonLoader label="Saving" /> : <>Save account & continue<ArrowRight size={17} /></>}</button></div>
                    {!accounts.length && <p className="payment-inline-warning">A funding account is required before you can continue.</p>}
                  </form>
                </div>
              </div>
            )}

            {step === 1 && (
              <form onSubmit={continueFromAmount}>
                <div className="payment-panel__heading"><div><span>STEP 2 · TRANSFER AMOUNT</span><h2 id="withdrawal-title">How much?</h2><p>Choose the Mellora account to fund this transfer. The amount can be any positive value up to your available balance. Your balance stays unchanged while pending.</p></div><WalletCards size={26} /></div>
                <div className="withdrawal-saved-account"><span>RECIPIENT</span><strong>{details.account_holder} · {details.bank_name}</strong><small>Account ending in {details.account_number.slice(-4)}</small><button type="button" onClick={() => setStep(0)}>Change account</button></div>
                <label className="payment-field"><span>Fund from</span><select value={accountId} onChange={(event) => setAccountId(event.target.value)} required>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {money(account.balance)}</option>)}</select></label>
                <div className="available-balance-line"><span>Available balance</span><strong>{money(selectedAccount?.balance)}</strong></div>
                <label className="payment-field"><span>Transfer amount</span><div className="payment-amount-input"><span>$</span><input type="number" min="0.01" max="999999999999.99" step="0.01" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" autoFocus required /></div></label>
                <div className="payment-form-actions"><button className="payment-secondary" type="button" onClick={() => setStep(0)}><ArrowLeft size={16} />Back</button><button className="button button--green" type="submit">Preview transfer<ArrowRight size={17} /></button></div>
              </form>
            )}

            {step === 2 && (
              <div>
                <div className="payment-panel__heading"><div><span>STEP 3 · TRANSFER PREVIEW</span><h2 id="withdrawal-title">Check every detail.</h2><p>Confirm the recipient, funding account, and amount. Selecting Transfer opens the serial-code pages until all four codes are confirmed.</p></div><CheckCircle2 size={26} /></div>
                <dl className="withdrawal-preview">
                  <div><dt>Recipient</dt><dd>{details.account_holder}</dd></div>
                  <div><dt>Recipient bank</dt><dd>{details.bank_name}</dd></div>
                  <div><dt>Account number</dt><dd>•••• {details.account_number.slice(-4)}</dd></div>
                  <div><dt>Fund from</dt><dd>{selectedAccount?.name} · •• {selectedAccount?.last4}</dd></div>
                  <div><dt>Four code fees</dt><dd>{money(feeTotal)} · shown separately</dd></div>
                  <div className="withdrawal-preview__total"><dt>Transfer amount</dt><dd>{money(roundedAmount)}</dd></div>
                </dl>
                <div className="payment-information"><LockKeyhole size={19} /><p>This creates a pending request only. It does not debit your balance or add a completed transaction. Code fees are not added to the transfer amount.</p></div>
                {!codeSetReady && <p className="payment-inline-warning">Ask your administrator to generate your four serial codes before continuing.</p>}
                <label className="withdrawal-agreement"><input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} /><span>I confirm that these transfer details are correct and want to continue to serial-code entry.</span></label>
                <div className="payment-form-actions"><button className="payment-secondary" type="button" onClick={() => setStep(1)}><ArrowLeft size={16} />Back</button><button className="button button--green" type="button" disabled={!agreed || !codeSetReady} onClick={startSerialVerification}>Transfer<KeyRound size={17} /></button></div>
              </div>
            )}

            {step === 3 && (
              <form onSubmit={handleSerialSubmit} className="sequential-code-form">
                <div className="payment-panel__heading"><div><span>STEP 4 · SERIAL CODE {serialStep + 1}</span><h2 id="withdrawal-title">{currentRequirement?.code_name || `Serial code ${serialStep + 1}`}</h2><p>{currentRequirement?.code_purpose || 'Enter the matching code supplied by your administrator.'}</p></div><KeyRound size={26} /></div>
                {confirmationNotice && <div className="serial-confirmation" role="status"><CheckCircle2 size={19} /><p>{confirmationNotice}</p></div>}
                <div className="serial-request-summary"><span>TRANSFER AMOUNT</span><strong>{money(roundedAmount)}</strong><small>{details.bank_name} · Account ending in {details.account_number.slice(-4)}</small></div>
                <section className="serial-fee-details" aria-labelledby={`fee-code-${serialStep + 1}`}>
                  <div><span>Fee to be paid</span><strong>{money(currentRequirement?.amount)}</strong></div>
                  <div><span>Fee status</span><strong className={currentConfirmed ? 'fee-status-paid' : ''}>{currentConfirmed ? 'Paid' : 'Unpaid'}</strong></div>
                  <p id={`fee-code-${serialStep + 1}`}><strong>{currentRequirement?.code_name || `Serial code ${serialStep + 1}`}</strong>{currentRequirement?.code_purpose}</p>
                </section>
                <label className="single-serial-field"><span>Serial code {serialStep + 1}</span><div><KeyRound size={20} /><input key={serialStep} value={serialCodes[serialStep]} onChange={(event) => updateSerialCode(event.target.value)} minLength="4" maxLength="12" autoCapitalize="characters" autoComplete="off" spellCheck="false" placeholder="ENTER CODE" aria-label={`Serial code ${serialStep + 1}`} disabled={processing || currentConfirmed} autoFocus required /></div></label>
                {currentConfirmed && <div className="serial-confirmed-stamp"><ShieldCheck size={19} /><span>Code {serialStep + 1} matched · Fee paid</span><small>Confirmation saved to Supabase and visible to your administrator</small></div>}
                <div className="payment-information"><LockKeyhole size={19} /><p>Only a matching code for this page marks its fee as paid. Raw serial codes are not stored. Complete all four pages to finish the transfer.</p></div>
                <div className="payment-form-actions"><button className="payment-secondary" type="button" onClick={() => { setError(''); setConfirmationNotice(''); if (serialStep > 0) setSerialStep((current) => current - 1); else setStep(2) }} disabled={processing}><ArrowLeft size={16} />Back</button><button className="button button--green" type="submit" disabled={processing || !currentRequirement}>{processing ? <ButtonLoader label={allConfirmed ? 'Submitting' : 'Checking'} /> : currentConfirmed ? (serialStep < 3 ? <>Continue to code {serialStep + 2}<ArrowRight size={17} /></> : <>Complete transfer<Check size={17} /></>) : <>Confirm code {serialStep + 1}<ShieldCheck size={17} /></>}</button></div>
              </form>
            )}

            {step === 4 && (
              <div className="withdrawal-success" role="status">
                <span className="withdrawal-success__icon"><Check size={30} /></span>
                <span>REQUEST SAVED</span>
                <h2 id="withdrawal-title">Your transfer is pending.</h2>
                <p>Your transfer for <strong>{money(roundedAmount)}</strong> to {details.bank_name}, account ending in {details.account_number.slice(-4)}, has been saved to Supabase.</p>
                <div className="withdrawal-reference"><span>REQUEST REFERENCE</span><strong>{requestId ? requestId.slice(0, 8).toUpperCase() : 'PENDING'}</strong><small>Status · Pending review</small></div>
                <div className="payment-information"><LockKeyhole size={19} /><p>Your account balance and completed transaction history have not changed.</p></div>
                <Link className="button button--green" to="/dashboard">Return to dashboard<ArrowRight size={17} /></Link>
              </div>
            )}
          </>
        )}
      </section>
    </PaymentFlowLayout>
  )
}
