import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, CheckCircle2, CircleAlert, KeyRound, Landmark, LockKeyhole, Pencil, Plus, ShieldCheck, WalletCards } from 'lucide-react'
import { Link, useLocation } from 'react-router'
import { supabase } from '../lib/supabase'
import { trackActivity } from '../lib/activity'
import { useAuth } from '../context/AuthContext'
import PaymentFlowLayout from '../components/PaymentFlowLayout'
import Loader, { ButtonLoader } from '../components/Loader'
import {
  createMethodDetails, destinationSummary, detailsFromSaved, getTransferMethod,
  transferMethods, validateMethodDetails,
} from '../lib/transferMethods'

const steps = ['Method & details', 'Amount', 'Preview', 'Serial codes']
const money = (value) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(Number(value || 0))
const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100
const emptyConfirmations = [false, false, false, false]
const accountFields = 'id, account_holder, bank_name, account_number, routing_number, method, network, created_at'
const draftFields = 'user_id, method, withdrawal_account_id, account_id, amount, serial_step, confirmed_codes, created_at, updated_at'
const normalizeConfirmations = (value) => Array.from({ length: 4 }, (_, index) => Boolean(Array.isArray(value) && value[index]))

export default function WithdrawalPage() {
  const { user, profile } = useAuth()
  const location = useLocation()
  const requestedMethod = getTransferMethod(location.state?.method)?.id || ''
  const [accounts, setAccounts] = useState([])
  const [savedAccounts, setSavedAccounts] = useState([])
  const [drafts, setDrafts] = useState([])
  const [method, setMethod] = useState(requestedMethod)
  const [details, setDetails] = useState(() => createMethodDetails(requestedMethod || 'bank', profile?.full_name || ''))
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

  const resumeDraft = useCallback((draft, accountList, recipientList) => {
    const recipient = recipientList.find((item) => item.id === draft.withdrawal_account_id)
    const fundingAccount = accountList.find((item) => item.id === draft.account_id)
    if (!recipient || !fundingAccount) return false
    setMethod(draft.method)
    setDetails(detailsFromSaved(recipient))
    setWithdrawalAccountId(recipient.id)
    setAccountId(fundingAccount.id)
    setAmount(Number(draft.amount).toFixed(2))
    setAgreed(true)
    setConfirmedCodes(normalizeConfirmations(draft.confirmed_codes))
    setSerialStep(Math.min(3, Math.max(0, Number(draft.serial_step) || 0)))
    setSerialCodes(['', '', '', ''])
    setConfirmationNotice('')
    setError('')
    setStep(3)
    return true
  }, [])

  const loadData = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setError('')
    try {
      const [accountResult, withdrawalResult, codeResult, draftResult] = await Promise.all([
        supabase.from('accounts').select('id, name, balance, currency, last4').eq('user_id', user.id).order('created_at'),
        supabase.from('withdrawal_accounts').select(accountFields).eq('user_id', user.id).order('created_at', { ascending: false }),
        supabase.rpc('member_get_serial_code_requirements'),
        supabase.from('member_transfer_drafts').select(draftFields).eq('user_id', user.id),
      ])
      const failure = accountResult.error || withdrawalResult.error || codeResult.error || draftResult.error
      if (failure) {
        setError(failure.message)
      } else {
        const nextAccounts = accountResult.data || []
        setAccounts(nextAccounts)
        setAccountId((current) => current || nextAccounts[0]?.id || '')
        const nextRecipients = withdrawalResult.data || []
        const nextDrafts = draftResult.data || []
        setSavedAccounts(nextRecipients)
        setCodeRequirements(codeResult.data || [])
        setDrafts(nextDrafts)
        if (requestedMethod) {
          const draft = nextDrafts.find((item) => item.method === requestedMethod)
          if (draft) resumeDraft(draft, nextAccounts, nextRecipients)
        }
        setDetails((current) => ({
          ...current,
          account_holder: current.account_holder || (current.method === 'usdt' ? '' : profile?.full_name || ''),
          bank_name: current.bank_name || getTransferMethod(current.method)?.provider || '',
        }))
      }
    } catch (requestError) {
      setError(requestError.message || 'Your transfer details could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [user, profile?.full_name, requestedMethod, resumeDraft])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'smooth' }) }, [step, serialStep])

  const selectedAccount = useMemo(() => accounts.find((account) => account.id === accountId), [accounts, accountId])
  const currentMethod = getTransferMethod(method)
  const MethodIcon = currentMethod?.icon || Landmark
  const methodAccounts = useMemo(() => savedAccounts.filter((account) => (account.method || 'bank') === method), [savedAccounts, method])
  const currentDraft = useMemo(() => drafts.find((draft) => draft.method === method), [drafts, method])
  const roundedAmount = roundMoney(amount)
  const codeSetReady = codeRequirements.length === 4
  const feeTotal = roundMoney(codeRequirements.reduce((sum, item) => sum + Number(item.amount || 0), 0))
  const currentRequirement = codeRequirements.find((item) => Number(item.slot) === serialStep + 1)
  const currentConfirmed = Boolean(confirmedCodes[serialStep])
  const allConfirmed = confirmedCodes.every(Boolean)

  const updateDetail = (field, value) => setDetails((current) => ({ ...current, [field]: value }))

  const selectMethod = (methodId) => {
    const draft = drafts.find((item) => item.method === methodId)
    if (draft && resumeDraft(draft, accounts, savedAccounts)) {
      trackActivity('withdrawal_draft_resumed', { method: methodId })
      return
    }
    setMethod(methodId)
    setDetails(createMethodDetails(methodId, profile?.full_name || ''))
    setWithdrawalAccountId('')
    setAmount('')
    setAgreed(false)
    setError('')
    setStep(0)
    trackActivity('withdrawal_method_selected', { method: methodId })
  }

  const changeMethod = () => {
    setMethod('')
    setDetails(createMethodDetails('bank', profile?.full_name || ''))
    setWithdrawalAccountId('')
    setAmount('')
    setAgreed(false)
    setError('')
    setStep(0)
  }

  const useSavedAccount = (account) => {
    setWithdrawalAccountId(account.id)
    setDetails(detailsFromSaved(account))
    setError('')
    setStep(1)
  }

  const editSavedAccount = (account) => {
    setWithdrawalAccountId(account.id)
    setDetails(detailsFromSaved(account))
    setError('')
    window.setTimeout(() => accountFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }

  const startNewAccount = () => {
    setWithdrawalAccountId('')
    setDetails(createMethodDetails(method, profile?.full_name || ''))
    setError('')
  }

  const saveDetails = async (event) => {
    event.preventDefault()
    const cleaned = Object.fromEntries(Object.entries(details).map(([key, value]) => [key, value.trim()]))
    cleaned.method = method
    cleaned.bank_name = method === 'bank' ? cleaned.bank_name : currentMethod?.provider || ''
    cleaned.network = method === 'usdt' ? cleaned.network : ''
    const validationError = validateMethodDetails(cleaned)
    if (validationError) {
      setError(validationError)
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
        setDetails(detailsFromSaved(data))
        setSavedAccounts((current) => {
          const exists = current.some((item) => item.id === data.id)
          return exists ? current.map((item) => item.id === data.id ? data : item) : [data, ...current]
        })
        trackActivity('withdrawal_details_saved', { method })
        setStep(1)
      }
    } catch (requestError) {
      setError(requestError.message || 'Your transfer details could not be saved.')
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
    trackActivity('withdrawal_amount_entered', { amount: roundedAmount, method })
    trackActivity('withdrawal_previewed', { amount: roundedAmount, method })
    setStep(2)
  }

  const persistDraft = async (nextSerialStep, nextConfirmed) => {
    const payload = {
      user_id: user.id,
      method,
      withdrawal_account_id: withdrawalAccountId,
      account_id: accountId,
      amount: roundedAmount,
      serial_step: nextSerialStep,
      confirmed_codes: nextConfirmed,
      updated_at: new Date().toISOString(),
    }
    const { data, error: draftError } = await supabase.from('member_transfer_drafts')
      .upsert(payload, { onConflict: 'user_id,method' })
      .select(draftFields)
      .single()
    if (draftError) {
      setError(`Your transfer progress could not be saved: ${draftError.message}`)
      return false
    }
    setDrafts((current) => {
      const exists = current.some((item) => item.method === method)
      return exists ? current.map((item) => item.method === method ? data : item) : [...current, data]
    })
    return true
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
        const nextConfirmed = confirmedCodes.map((confirmed, index) => index === serialStep ? true : confirmed)
        setConfirmedCodes(nextConfirmed)
        const saved = await persistDraft(serialStep, nextConfirmed)
        if (saved) setConfirmationNotice(`Serial code ${serialStep + 1} matched. Its fee of ${money(verified?.amount)} is now marked as paid.`)
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
        await supabase.from('member_transfer_drafts').delete().eq('user_id', user.id).eq('method', method)
        setDrafts((current) => current.filter((item) => item.method !== method))
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

  const handleSerialSubmit = async (event) => {
    if (currentConfirmed) {
      event.preventDefault()
      if (serialStep < 3) {
        const nextIndex = serialStep + 1
        setProcessing(true)
        const saved = await persistDraft(nextIndex, confirmedCodes)
        setProcessing(false)
        if (saved) {
          setSerialStep(nextIndex)
          setConfirmationNotice(`Code ${serialStep + 1} is paid. Enter serial code ${nextIndex + 1}.`)
          setError('')
        }
      } else {
        submitRequest(event)
      }
      return
    }
    verifyCurrentCode(event)
  }

  const startSerialVerification = async () => {
    const nextConfirmed = currentDraft ? normalizeConfirmations(confirmedCodes) : [...emptyConfirmations]
    const nextSerialStep = currentDraft ? serialStep : 0
    setProcessing(true)
    setError('')
    const saved = await persistDraft(nextSerialStep, nextConfirmed)
    setProcessing(false)
    if (!saved) return
    setSerialCodes(['', '', '', ''])
    setConfirmedCodes(nextConfirmed)
    setSerialStep(nextSerialStep)
    setConfirmationNotice('')
    trackActivity('withdrawal_serial_codes_started', { amount: roundedAmount, method })
    setStep(3)
  }

  const goBackFromSerial = async () => {
    const nextSerialStep = serialStep > 0 ? serialStep - 1 : 0
    setProcessing(true)
    const saved = await persistDraft(nextSerialStep, confirmedCodes)
    setProcessing(false)
    if (!saved) return
    setError('')
    setConfirmationNotice('')
    if (serialStep > 0) setSerialStep(nextSerialStep)
    else setStep(2)
  }

  return (
    <PaymentFlowLayout title={currentMethod ? `Transfer with ${currentMethod.name}` : 'Request a transfer'} eyebrow="MEMBER TRANSFER" steps={steps} currentStep={step}>
      <section className="payment-panel withdrawal-panel" aria-labelledby="withdrawal-title">
        {error && <div className="payment-error" role="alert"><CircleAlert size={21} /><div><strong>We couldn’t continue</strong><p>{error}</p></div></div>}
        {loading ? <Loader label="Loading your saved transfer details" /> : (
          <>
            {step === 0 && !method && (
              <div>
                <div className="payment-panel__heading"><div><span>STEP 1 · WITHDRAWAL METHOD</span><h2 id="withdrawal-title">How should it arrive?</h2><p>Choose a transfer method. You will then enter the necessary recipient details, save them for next time, and continue from your available balance.</p></div><WalletCards size={26} /></div>
                <div className="transfer-method-picker">
                  {transferMethods.map((item) => {
                    const ItemIcon = item.icon
                    return <button type="button" key={item.id} onClick={() => selectMethod(item.id)}><span className="transfer-method-icon"><ItemIcon size={20} /></span><span><strong>{item.name}</strong><small>{item.description}</small></span><ArrowRight size={17} /></button>
                  })}
                </div>
              </div>
            )}

            {step === 0 && method && currentMethod && (
              <div>
                <div className="payment-panel__heading"><div><span>STEP 1 · {currentMethod.name.toUpperCase()} DETAILS</span><h2 id="withdrawal-title">Where should it go?</h2><p>Choose your saved {currentMethod.name} details or add a new recipient below.</p></div><MethodIcon size={26} /></div>
                <button type="button" className="payment-secondary method-back-button" onClick={changeMethod}><ArrowLeft size={15} />All withdrawal methods</button>
                <section className="saved-recipients" aria-labelledby="saved-recipients-title">
                  <div className="recipient-section-heading"><div><span>SAVED {currentMethod.name.toUpperCase()} DETAILS</span><h3 id="saved-recipients-title">Choose a recipient.</h3></div><small>{methodAccounts.length} saved</small></div>
                  <div className="saved-recipient-list">
                    {methodAccounts.map((account) => <article key={account.id}><div><strong>{account.account_holder}</strong><span>{account.method === 'usdt' ? `USDT · ${account.network}` : currentMethod.name}{account.method === 'bank' && account.bank_name ? ` · ${account.bank_name}` : ''}</span><small>{destinationSummary(detailsFromSaved(account))}{account.routing_number ? ` · Routing ${account.routing_number}` : ''}</small></div><div><button type="button" onClick={() => editSavedAccount(account)}><Pencil size={14} />Edit</button><button type="button" onClick={() => useSavedAccount(account)}>Use details<ArrowRight size={14} /></button></div></article>)}
                    {!methodAccounts.length && <p className="empty-copy">No {currentMethod.name} details have been saved yet. Add your first recipient below.</p>}
                  </div>
                </section>
                <div className="recipient-account-form" ref={accountFormRef}>
                  <div className="recipient-section-heading"><div><span>{withdrawalAccountId ? 'EDIT SAVED DETAILS' : 'INPUT NEW DETAILS'}</span><h3>{withdrawalAccountId ? 'Update recipient details.' : `Add ${currentMethod.name} details.`}</h3></div>{withdrawalAccountId && <button type="button" onClick={startNewAccount}><Plus size={15} />New details</button>}</div>
                  <form onSubmit={saveDetails}>
                    <div className="payment-form-grid">
                      <label className="payment-field payment-field--wide"><span>{currentMethod.holderLabel}</span><input value={details.account_holder} onChange={(event) => updateDetail('account_holder', event.target.value)} maxLength="120" autoComplete={method === 'usdt' ? 'off' : 'name'} placeholder={currentMethod.holderPlaceholder} disabled={processing} required /></label>
                      {method === 'bank' && <label className="payment-field payment-field--wide"><span>Bank name</span><input value={details.bank_name} onChange={(event) => updateDetail('bank_name', event.target.value)} maxLength="120" autoComplete="organization" placeholder="Recipient bank" disabled={processing} required /></label>}
                      <label className={`payment-field ${method === 'bank' ? '' : 'payment-field--wide'}`}><span>{currentMethod.destinationLabel}</span><input type={currentMethod.destinationType || 'text'} value={details.account_number} onChange={(event) => updateDetail('account_number', event.target.value)} minLength="4" maxLength={currentMethod.destinationMaxLength} autoComplete={currentMethod.destinationAutoComplete || 'off'} placeholder={currentMethod.destinationPlaceholder} disabled={processing} required /></label>
                      {method === 'bank' && <label className="payment-field"><span>Routing number <small>Optional</small></span><input value={details.routing_number} onChange={(event) => updateDetail('routing_number', event.target.value)} maxLength="34" inputMode="numeric" autoComplete="off" placeholder="Sort code or routing number" disabled={processing} /></label>}
                      {method === 'usdt' && <label className="payment-field payment-field--wide"><span>USDT network</span><select value={details.network} onChange={(event) => updateDetail('network', event.target.value)} disabled={processing} required>{currentMethod.networks.map((network) => <option key={network} value={network}>{network}</option>)}</select></label>}
                    </div>
                    {method === 'usdt' && <div className="payment-information"><LockKeyhole size={18} /><p>Use only a wallet address that matches the selected network. The network and address are saved with this recipient.</p></div>}
                    <div className="payment-form-actions"><span>Saved securely to your member profile.</span><button className="button button--green" type="submit" disabled={processing || !accounts.length}>{processing ? <ButtonLoader label="Saving" /> : <>Save details & continue<ArrowRight size={17} /></>}</button></div>
                    {!accounts.length && <p className="payment-inline-warning">A funding account is required before you can continue.</p>}
                  </form>
                </div>
              </div>
            )}

            {step === 1 && currentMethod && (
              <form onSubmit={continueFromAmount}>
                <div className="payment-panel__heading"><div><span>STEP 2 · TRANSFER AMOUNT</span><h2 id="withdrawal-title">How much?</h2><p>Choose the Mellora account to fund this {currentMethod.name} transfer. The amount can be any positive value up to your available balance. Your balance stays unchanged while pending.</p></div><WalletCards size={26} /></div>
                <div className="withdrawal-saved-account"><span>{currentMethod.name.toUpperCase()}{details.network ? ` · ${details.network}` : ''}</span><strong>{details.account_holder}</strong><small>{destinationSummary(details)}</small><button type="button" onClick={() => setStep(0)}>Change details</button></div>
                <label className="payment-field"><span>Fund from</span><select value={accountId} onChange={(event) => setAccountId(event.target.value)} required>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {money(account.balance)}</option>)}</select></label>
                <div className="available-balance-line"><span>Available balance</span><strong>{money(selectedAccount?.balance)}</strong></div>
                <label className="payment-field"><span>Transfer amount</span><div className="payment-amount-input"><span>$</span><input type="number" min="0.01" max="999999999999.99" step="0.01" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" autoFocus required /></div></label>
                <div className="payment-form-actions"><button className="payment-secondary" type="button" onClick={() => setStep(0)}><ArrowLeft size={16} />Back</button><button className="button button--green" type="submit">Preview transfer<ArrowRight size={17} /></button></div>
              </form>
            )}

            {step === 2 && currentMethod && (
              <div>
                <div className="payment-panel__heading"><div><span>STEP 3 · TRANSFER PREVIEW</span><h2 id="withdrawal-title">Check every detail.</h2><p>Confirm the method, recipient, funding account, and amount. Selecting Transfer opens the serial-code pages until all four codes are confirmed.</p></div><CheckCircle2 size={26} /></div>
                <dl className="withdrawal-preview">
                  <div><dt>Transfer method</dt><dd>{currentMethod.name}{details.network ? ` · ${details.network}` : ''}</dd></div>
                  <div><dt>Recipient</dt><dd>{details.account_holder}</dd></div>
                  {method === 'bank' && <div><dt>Recipient bank</dt><dd>{details.bank_name}</dd></div>}
                  <div><dt>{currentMethod.destinationLabel}</dt><dd>{destinationSummary(details)}</dd></div>
                  <div><dt>Fund from</dt><dd>{selectedAccount?.name} · •• {selectedAccount?.last4}</dd></div>
                  <div><dt>Four code fees</dt><dd>{money(feeTotal)} · shown separately</dd></div>
                  <div className="withdrawal-preview__total"><dt>Transfer amount</dt><dd>{money(roundedAmount)}</dd></div>
                </dl>
                <div className="payment-information"><LockKeyhole size={19} /><p>This creates a pending request only. It does not debit your balance or add a completed transaction. Code fees are not added to the transfer amount.</p></div>
                {!codeSetReady && <p className="payment-inline-warning">Ask your administrator to generate your four serial codes before continuing.</p>}
                <label className="withdrawal-agreement"><input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} /><span>I confirm that these transfer details are correct and want to continue to serial-code entry.</span></label>
                <div className="payment-form-actions"><button className="payment-secondary" type="button" onClick={() => setStep(1)}><ArrowLeft size={16} />Back</button><button className="button button--green" type="button" disabled={processing || !agreed || !codeSetReady} onClick={startSerialVerification}>{processing ? <ButtonLoader label="Saving" /> : <>Transfer<KeyRound size={17} /></>}</button></div>
              </div>
            )}

            {step === 3 && currentMethod && (
              <form onSubmit={handleSerialSubmit} className="sequential-code-form">
                <div className="payment-panel__heading"><div><span>STEP 4 · SERIAL CODE {serialStep + 1}</span><h2 id="withdrawal-title">{currentRequirement?.code_name || `Serial code ${serialStep + 1}`}</h2><p>{currentRequirement?.code_purpose || 'Enter the matching code supplied by your administrator.'}</p></div><KeyRound size={26} /></div>
                {confirmationNotice && <div className="serial-confirmation" role="status"><CheckCircle2 size={19} /><p>{confirmationNotice}</p></div>}
                <div className="serial-request-summary"><span>TRANSFER AMOUNT</span><strong>{money(roundedAmount)}</strong><small>{currentMethod.name}{details.network ? ` · ${details.network}` : ''} · {destinationSummary(details)}</small></div>
                <section className="serial-fee-details" aria-labelledby={`fee-code-${serialStep + 1}`}>
                  <div><span>Fee to be paid</span><strong>{money(currentRequirement?.amount)}</strong></div>
                  <div><span>Fee status</span><strong className={currentConfirmed ? 'fee-status-paid' : ''}>{currentConfirmed ? 'Paid' : 'Unpaid'}</strong></div>
                  <p id={`fee-code-${serialStep + 1}`}><strong>{currentRequirement?.code_name || `Serial code ${serialStep + 1}`}</strong>{currentRequirement?.code_purpose}</p>
                </section>
                <label className="single-serial-field"><span>Serial code {serialStep + 1}</span><div><KeyRound size={20} /><input key={serialStep} value={serialCodes[serialStep]} onChange={(event) => updateSerialCode(event.target.value)} minLength="4" maxLength="12" autoCapitalize="characters" autoComplete="off" spellCheck="false" placeholder="ENTER CODE" aria-label={`Serial code ${serialStep + 1}`} disabled={processing || currentConfirmed} autoFocus required /></div></label>
                {currentConfirmed && <div className="serial-confirmed-stamp"><ShieldCheck size={19} /><span>Code {serialStep + 1} matched · Fee paid</span><small>Confirmation saved to Supabase and visible to your administrator</small></div>}
                <div className="payment-information"><LockKeyhole size={19} /><p>Only a matching code for this page marks its fee as paid. Codes you enter are checked securely and are not included in the transfer request. Complete all four pages to finish.</p></div>
                <div className="payment-form-actions"><button className="payment-secondary" type="button" onClick={goBackFromSerial} disabled={processing}><ArrowLeft size={16} />Back</button><button className="button button--green" type="submit" disabled={processing || !currentRequirement}>{processing ? <ButtonLoader label={allConfirmed ? 'Submitting' : 'Checking'} /> : currentConfirmed ? (serialStep < 3 ? <>Continue to code {serialStep + 2}<ArrowRight size={17} /></> : <>Complete transfer<Check size={17} /></>) : <>Confirm code {serialStep + 1}<ShieldCheck size={17} /></>}</button></div>
              </form>
            )}

            {step === 4 && currentMethod && (
              <div className="withdrawal-success" role="status">
                <span className="withdrawal-success__icon"><Check size={30} /></span>
                <span>REQUEST SAVED</span>
                <h2 id="withdrawal-title">Your transfer is pending.</h2>
                <p>Your {currentMethod.name} transfer for <strong>{money(roundedAmount)}</strong> to {details.account_holder} has been saved to Supabase.</p>
                <div className="withdrawal-reference"><span>REQUEST REFERENCE</span><strong>{requestId ? requestId.slice(0, 8).toUpperCase() : 'PENDING'}</strong><small>{currentMethod.name}{details.network ? ` · ${details.network}` : ''} · Pending review</small></div>
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
