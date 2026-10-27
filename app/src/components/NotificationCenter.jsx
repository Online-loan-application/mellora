import { useEffect, useRef, useState } from 'react'
import { Bell, Check, CheckCheck, MailOpen, ShieldCheck, WalletCards, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { ButtonLoader } from './Loader'

const notificationDate = (value) => new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
}).format(new Date(value))

export default function NotificationCenter({ notifications, setNotifications }) {
  const [open, setOpen] = useState(false)
  const [updating, setUpdating] = useState('')
  const [error, setError] = useState('')
  const root = useRef(null)
  const trigger = useRef(null)
  const closeButton = useRef(null)
  const unread = notifications.filter((item) => !item.read_at)

  useEffect(() => {
    if (!open) return
    closeButton.current?.focus()
    const onKey = (event) => {
      if (event.key === 'Escape') {
        setOpen(false)
        trigger.current?.focus()
      }
    }
    const onPointer = (event) => {
      if (!root.current?.contains(event.target)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  const markRead = async (item) => {
    if (item.read_at) return
    setUpdating(item.id)
    setError('')
    const readAt = new Date().toISOString()
    const { error: updateError } = await supabase.from('notifications').update({ read_at: readAt }).eq('id', item.id)
    if (updateError) setError(updateError.message)
    else setNotifications((items) => items.map((entry) => entry.id === item.id ? { ...entry, read_at: readAt } : entry))
    setUpdating('')
  }

  const markAllRead = async () => {
    if (!unread.length) return
    setUpdating('all')
    setError('')
    const readAt = new Date().toISOString()
    const ids = unread.map((item) => item.id)
    const { error: updateError } = await supabase.from('notifications').update({ read_at: readAt }).in('id', ids)
    if (updateError) setError(updateError.message)
    else setNotifications((items) => items.map((item) => ids.includes(item.id) ? { ...item, read_at: readAt } : item))
    setUpdating('')
  }

  return (
    <div className="notification-center" ref={root}>
      <button
        className="icon-action notification-trigger"
        type="button"
        ref={trigger}
        aria-label={unread.length ? `Notifications, ${unread.length} unread` : 'Notifications'}
        aria-expanded={open}
        aria-controls="member-notifications"
        onClick={() => { setOpen(!open); setError('') }}
      >
        <Bell size={18} />
        {unread.length > 0 && <span className="notification-badge">{unread.length > 9 ? '9+' : unread.length}</span>}
      </button>

      {open && <section className="notification-popover" id="member-notifications" aria-label="Notifications">
        <div className="notification-heading">
          <div><span>YOUR UPDATES</span><h2>Notifications</h2></div>
          <button type="button" ref={closeButton} onClick={() => { setOpen(false); trigger.current?.focus() }} aria-label="Close notifications"><X size={18} /></button>
        </div>
        {error && <p className="notification-error" role="alert">{error}</p>}
        <div className="notification-list" aria-live="polite">
          {notifications.map((item) => <article className={`notification-item ${item.read_at ? '' : 'unread'}`} key={item.id}>
            <span className="notification-item__icon">{item.type === 'balance' ? <WalletCards size={18} /> : <ShieldCheck size={18} />}</span>
            <div>
              <div className="notification-item__title"><strong>{item.title}</strong>{!item.read_at && <span>NEW</span>}</div>
              <p>{item.message}</p>
              <small>{notificationDate(item.created_at)}</small>
            </div>
            {!item.read_at && <button type="button" className="notification-read" onClick={() => markRead(item)} disabled={updating !== ''} aria-label={`Mark ${item.title} as read`}>
              {updating === item.id ? <ButtonLoader label="" /> : <Check size={16} />}
            </button>}
          </article>)}
          {!notifications.length && <div className="notification-empty"><MailOpen size={28} /><strong>You’re all caught up.</strong><p>Balance updates and messages from Mellora will appear here.</p></div>}
        </div>
        {notifications.length > 0 && <button className="notification-mark-all" type="button" onClick={markAllRead} disabled={!unread.length || updating !== ''}>
          {updating === 'all' ? <ButtonLoader label="Marking all as read" /> : <><CheckCheck size={17} />{unread.length ? 'Mark all as read' : 'All notifications read'}</>}
        </button>}
      </section>}
    </div>
  )
}
