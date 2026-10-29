import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { CheckCircle2, CircleAlert, Info, X } from 'lucide-react'

const ToastContext = createContext(null)
let nextToastId = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timers = useRef(new Map())

  const dismissToast = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
    const timer = timers.current.get(id)
    if (timer) window.clearTimeout(timer)
    timers.current.delete(id)
  }, [])

  const showToast = useCallback((message, type = 'info', title = '') => {
    if (!message) return null
    const id = ++nextToastId
    const toast = { id, message, type, title }
    setToasts((current) => [...current.slice(-3), toast])
    const timer = window.setTimeout(() => dismissToast(id), type === 'error' ? 7000 : 5000)
    timers.current.set(id, timer)
    return id
  }, [dismissToast])

  useEffect(() => () => {
    timers.current.forEach((timer) => window.clearTimeout(timer))
    timers.current.clear()
  }, [])

  return (
    <ToastContext.Provider value={{ showToast, dismissToast }}>
      {children}
      <div className="toast-region" aria-label="Account feedback" aria-live="polite">
        {toasts.map((toast) => {
          const Icon = toast.type === 'success' ? CheckCircle2 : toast.type === 'error' ? CircleAlert : Info
          const title = toast.title || (toast.type === 'success' ? 'Success' : toast.type === 'error' ? 'Something needs attention' : 'Account update')
          return (
            <section className={`toast toast--${toast.type}`} key={toast.id} role={toast.type === 'error' ? 'alert' : 'status'}>
              <span className="toast__icon"><Icon size={21} /></span>
              <div><strong>{title}</strong><p>{toast.message}</p></div>
              <button type="button" onClick={() => dismissToast(toast.id)} aria-label="Dismiss message"><X size={17} /></button>
              <i className="toast__timer" aria-hidden="true" />
            </section>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside ToastProvider')
  return context
}
