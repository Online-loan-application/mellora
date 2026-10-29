import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Clock3, FileImage, RefreshCw, UploadCloud } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import Loader, { ButtonLoader } from './Loader'

const receiptFields = 'id, image_path, original_name, mime_type, size_bytes, status, uploaded_at, confirmed_at'
const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
const maxBytes = 10 * 1024 * 1024
const dateTime = (value) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value))

export default function DepositReceipt({ onStatusChange }) {
  const { user } = useAuth()
  const { showToast } = useToast()
  const [receipt, setReceipt] = useState(null)
  const [imageUrl, setImageUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  const loadReceipt = useCallback(async (quiet = false) => {
    quiet ? setRefreshing(true) : setLoading(true)
    setError('')
    try {
      const { data, error: receiptError } = await supabase
        .from('deposit_receipts')
        .select(receiptFields)
        .eq('user_id', user.id)
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
      if (quiet) showToast('Receipt status refreshed.', 'success')
    } catch (requestError) {
      setError(requestError.message || 'Your receipt status could not be loaded.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [user, showToast])

  useEffect(() => { loadReceipt() }, [loadReceipt])
  useEffect(() => { onStatusChange?.(receipt?.status || '') }, [receipt, onStatusChange])
  useEffect(() => { if (error) showToast(error, 'error') }, [error, showToast])

  const uploadReceipt = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || receipt?.status === 'confirming') return
    if (!allowedTypes.includes(file.type)) {
      setError('Choose a JPEG, PNG, WebP, HEIC, or HEIF receipt image.')
      return
    }
    if (file.size > maxBytes) {
      setError('Your receipt image must be 10 MB or smaller.')
      return
    }

    setUploading(true)
    setError('')
    const extension = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'image'
    const imagePath = `${user.id}/${crypto.randomUUID()}.${extension}`
    try {
      const { error: uploadError } = await supabase.storage
        .from('deposit-receipts')
        .upload(imagePath, file, { contentType: file.type, upsert: false })
      if (uploadError) throw uploadError

      const { data: saved, error: saveError } = await supabase
        .from('deposit_receipts')
        .insert({
          user_id: user.id,
          image_path: imagePath,
          original_name: file.name,
          mime_type: file.type,
          size_bytes: file.size,
        })
        .select(receiptFields)
        .single()
      if (saveError) {
        await supabase.storage.from('deposit-receipts').remove([imagePath])
        throw saveError
      }

      setReceipt(saved)
      const { data: signed, error: signedError } = await supabase.storage
        .from('deposit-receipts')
        .createSignedUrl(imagePath, 3600)
      if (signedError) throw signedError
      setImageUrl(signed.signedUrl)
      showToast('Receipt uploaded. Your administrator can now review it.', 'success')
    } catch (requestError) {
      setError(requestError.message || 'Your receipt could not be uploaded. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  const confirming = receipt?.status === 'confirming'
  const confirmed = receipt?.status === 'confirmed'

  return (
    <section className="payment-panel receipt-panel" aria-labelledby="receipt-title">
      <div className="payment-panel__heading">
        <div><span>PAYMENT RECEIPT</span><h2 id="receipt-title">{confirming ? 'Confirming receipt.' : confirmed ? 'Receipt confirmed.' : 'Upload your receipt.'}</h2><p>{confirming ? 'Your administrator has been notified. This status remains until they confirm your receipt.' : confirmed ? 'Your administrator confirmed this payment receipt.' : 'Send a clear image of your payment receipt for administrator review.'}</p></div>
        <button className="icon-action" type="button" onClick={() => loadReceipt(true)} disabled={refreshing || uploading} aria-label="Refresh receipt status">{refreshing ? <ButtonLoader label="" /> : <RefreshCw size={18} />}</button>
      </div>

      {loading ? <Loader label="Loading receipt status" /> : <>
        {error && <p className="member-tool-error" role="alert">{error}</p>}
        {receipt && <div className={`receipt-status receipt-status--${receipt.status}`} role="status">
          {confirmed ? <CheckCircle2 size={20} /> : <Clock3 size={20} />}
          <div><strong>{confirmed ? 'Confirmed by administrator' : 'Confirming receipt'}</strong><span>{confirmed && receipt.confirmed_at ? `Confirmed ${dateTime(receipt.confirmed_at)}` : `Uploaded ${dateTime(receipt.uploaded_at)}`}</span></div>
        </div>}

        {receipt && <div className="receipt-document">
          {imageUrl ? <a href={imageUrl} target="_blank" rel="noreferrer" aria-label="Open uploaded receipt image"><img src={imageUrl} alt="Uploaded payment receipt" /></a> : <span className="receipt-document__placeholder"><FileImage size={30} /></span>}
          <div><strong>{receipt.original_name}</strong><span>{(Number(receipt.size_bytes) / 1024 / 1024).toFixed(2)} MB</span>{imageUrl && <a href={imageUrl} target="_blank" rel="noreferrer">Open receipt</a>}</div>
        </div>}

        {!confirming && <label className={`receipt-upload ${uploading ? 'receipt-upload--busy' : ''}`}>
          <UploadCloud size={25} />
          <span><strong>{uploading ? 'Uploading receipt…' : confirmed ? 'Upload another receipt' : 'Choose receipt image'}</strong><small>JPEG, PNG, WebP, HEIC, or HEIF · up to 10 MB</small></span>
          <input type="file" accept=".jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={uploadReceipt} disabled={uploading} />
          {uploading && <ButtonLoader label="" />}
        </label>}
      </>}
    </section>
  )
}
