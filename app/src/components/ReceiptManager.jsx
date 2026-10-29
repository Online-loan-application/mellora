import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Clock3, ExternalLink, FileImage, Image, RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useToast } from '../context/ToastContext'
import Loader, { ButtonLoader } from './Loader'

const receiptFields = 'id, image_path, original_name, mime_type, size_bytes, status, uploaded_at, confirmed_at, confirmed_by'
const dateTime = (value) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value))

export default function ReceiptManager({ memberId, adminId, memberName }) {
  const { showToast } = useToast()
  const [receipt, setReceipt] = useState(null)
  const [imageUrl, setImageUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')

  const loadReceipt = useCallback(async (quiet = false) => {
    quiet ? setRefreshing(true) : setLoading(true)
    setError('')
    try {
      const { data, error: receiptError } = await supabase
        .from('deposit_receipts')
        .select(receiptFields)
        .eq('user_id', memberId)
        .order('uploaded_at', { ascending: false })
        .limit(1)
      if (receiptError) throw receiptError
      const latest = data?.[0] || null
      setReceipt(latest)
      setImageUrl('')
      if (latest) {
        const { data: signed, error: signedError } = await supabase.storage
          .from('deposit-receipts')
          .createSignedUrl(latest.image_path, 3600)
        if (signedError) throw signedError
        setImageUrl(signed.signedUrl)
      }
      if (quiet) showToast('Member receipt refreshed.', 'success')
    } catch (requestError) {
      setError(requestError.message || 'The member receipt could not be loaded.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [memberId, showToast])

  useEffect(() => { loadReceipt() }, [loadReceipt])
  useEffect(() => { if (error) showToast(error, 'error') }, [error, showToast])

  const confirmReceipt = async () => {
    if (!receipt || receipt.status !== 'confirming') return
    setConfirming(true)
    setError('')
    try {
      const { data, error: confirmError } = await supabase
        .from('deposit_receipts')
        .update({ status: 'confirmed', confirmed_at: new Date().toISOString(), confirmed_by: adminId })
        .eq('id', receipt.id)
        .eq('status', 'confirming')
        .select(receiptFields)
        .single()
      if (confirmError) throw confirmError
      setReceipt(data)
      showToast(`Receipt confirmed for ${memberName}.`, 'success')
    } catch (requestError) {
      setError(requestError.message || 'The receipt could not be confirmed.')
    } finally {
      setConfirming(false)
    }
  }

  return (
    <section className="admin-panel member-tool receipt-manager" aria-labelledby="member-receipt-title">
      <div className="card-heading"><div><span>MEMBER PAYMENT RECEIPT</span><h2 id="member-receipt-title">Receipt review</h2><p>Retrieve the member’s latest private upload and confirm it after checking the image.</p></div><Image size={22} /></div>
      <div className="receipt-manager__actions"><button className="icon-action" type="button" onClick={() => loadReceipt(true)} disabled={refreshing || confirming} aria-label="Refresh member receipt">{refreshing ? <ButtonLoader label="" /> : <RefreshCw size={18} />}</button></div>

      {loading ? <Loader label="Loading member receipt" /> : <>
        {error && <p className="member-tool-error" role="alert">{error}</p>}
        {!receipt ? <div className="receipt-manager__empty"><FileImage size={28} /><strong>No receipt uploaded.</strong><p>The member’s latest receipt will appear here after they upload it from the deposit page.</p></div> : <>
          <div className={`receipt-status receipt-status--${receipt.status}`} role="status">
            {receipt.status === 'confirmed' ? <CheckCircle2 size={20} /> : <Clock3 size={20} />}
            <div><strong>{receipt.status === 'confirmed' ? 'Receipt confirmed' : 'Confirming receipt'}</strong><span>Uploaded {dateTime(receipt.uploaded_at)}{receipt.confirmed_at ? ` · Confirmed ${dateTime(receipt.confirmed_at)}` : ''}</span></div>
          </div>
          <div className="receipt-admin-preview">
            {imageUrl ? <a href={imageUrl} target="_blank" rel="noreferrer"><img src={imageUrl} alt={`Payment receipt uploaded by ${memberName}`} /></a> : <div><FileImage size={30} /><span>Image preview unavailable</span></div>}
          </div>
          <div className="receipt-admin-meta"><div><strong>{receipt.original_name}</strong><span>{receipt.mime_type} · {(Number(receipt.size_bytes) / 1024 / 1024).toFixed(2)} MB</span></div>{imageUrl && <a href={imageUrl} target="_blank" rel="noreferrer">Open full image<ExternalLink size={15} /></a>}</div>
          {receipt.status === 'confirming' && <button className="button button--green receipt-confirm-button" type="button" onClick={confirmReceipt} disabled={confirming}>{confirming ? <ButtonLoader label="Confirming" /> : <><CheckCircle2 size={17} />Confirm receipt</>}</button>}
        </>}
      </>}
    </section>
  )
}
