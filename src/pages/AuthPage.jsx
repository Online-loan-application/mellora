import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router'
import { ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import Logo from '../components/Logo'
import Loader, { ButtonLoader } from '../components/Loader'

const authErrorMessage = (error) => {
  const raw = error?.message || ''
  const message = raw.toLowerCase()
  if (message.includes('email rate limit')) return 'Supabase’s email-sending limit has been reached. Wait for it to reset, or configure custom SMTP before sending more signup or magic-link emails.'
  if (message.includes('rate limit')) return 'Too many requests were made in a short time. Wait a few minutes, then try again.'
  if (message.includes('invalid login credentials')) return 'The email or password is incorrect. Check your details and try again.'
  if (message.includes('email not confirmed')) return 'Confirm your email address first, then return to sign in.'
  if (message.includes('already registered')) return 'An account already exists for this email. Sign in instead.'
  if (message.includes('failed to fetch') || message.includes('network') || message.includes('proxy') || message.includes('timed out')) return 'We could not reach Supabase. Check your internet, VPN, or proxy settings, then try again.'
  return raw || 'We could not complete the request. Check your connection and try again.'
}

const withTimeout = (request, milliseconds = 20000) => new Promise((resolve, reject) => {
  const timer = window.setTimeout(() => reject(new Error('The request timed out')), milliseconds)
  request.then(
    (result) => { window.clearTimeout(timer); resolve(result) },
    (error) => { window.clearTimeout(timer); reject(error) },
  )
})

export default function AuthPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialMode = searchParams.get('mode') === 'signup' ? 'signup' : 'signin'
  const [mode, setMode] = useState(initialMode)
  const [magic, setMagic] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [form, setForm] = useState({ fullName: '', email: '', password: '' })
  const [processing, setProcessing] = useState(false)
  const [message, setMessage] = useState({ type: '', text: '' })
  const { user, loading, signIn, signUp, sendMagicLink } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  if (!loading && user) return <Navigate to="/dashboard" replace />

  const switchMode = (nextMode) => {
    setMode(nextMode)
    setSearchParams(nextMode === 'signup' ? { mode: 'signup' } : {})
    setMessage({ type: '', text: '' })
  }

  const submit = async (event) => {
    event.preventDefault()
    setMessage({ type: '', text: '' })
    if (!form.email.includes('@')) {
      setMessage({ type: 'error', text: 'Enter a valid email address.' })
      return
    }
    if (!magic && mode === 'signup' && form.fullName.trim().length < 2) {
      setMessage({ type: 'error', text: 'Tell us the name you would like to use.' })
      return
    }
    if (!magic && form.password.length < 8) {
      setMessage({ type: 'error', text: 'Your password needs at least 8 characters.' })
      return
    }

    setProcessing(true)
    try {
      const request = magic
        ? sendMagicLink(form.email)
        : mode === 'signup'
          ? signUp(form.email, form.password, form.fullName.trim())
          : signIn(form.email, form.password)
      const result = await withTimeout(request)

      if (result.error) {
        setMessage({ type: 'error', text: authErrorMessage(result.error) })
        return
      }
      if (magic) {
        setMessage({ type: 'success', text: 'Your secure sign-in link is on its way. Check your inbox.' })
        return
      }
      if (mode === 'signup' && !result.data.session) {
        setMessage({ type: 'success', text: 'Account created. Confirm your email, then return to sign in.' })
        return
      }
      navigate(location.state?.from || '/dashboard', { replace: true })
    } catch (error) {
      setMessage({ type: 'error', text: authErrorMessage(error) })
    } finally {
      setProcessing(false)
    }
  }

  const submitLabel = magic ? 'Send magic link' : mode === 'signup' ? 'Create my account' : 'Sign in securely'

  return (
    <main className="auth-page">
      <section className="auth-story">
        <div className="auth-story__top"><Logo inverse /><Link to="/" className="auth-back"><ArrowLeft size={16} /> Back to site</Link></div>
        <div className="auth-story__copy">
          <span>WELCOME TO MELLORA</span>
          <h1>Your money.<br /><em>Your mellow.</em></h1>
          <p>A secure doorway to your accounts, activity, and savings—all in one calm place.</p>
        </div>
        <div className="auth-art" aria-hidden="true">
          <div className="auth-art__orbit"><i /><i /><span /></div>
          <div className="auth-art__card"><LockKeyhole size={28} /><small>SECURE SESSION</small><strong>Protected by design</strong><div><i /><i /><i /><i /><i /><i /></div></div>
          <div className="auth-art__chip"><ShieldCheck size={20} /><span>Supabase authentication</span></div>
        </div>
        <small className="auth-story__foot">Private, secure access to your Mellora account</small>
      </section>

      <section className="auth-form-side">
        <div className="auth-mobile-logo"><Logo /><Link to="/">Back</Link></div>
        <div className="auth-form-wrap">
          <span className="auth-eyebrow">{magic ? 'PASSWORDLESS ACCESS' : mode === 'signup' ? 'CREATE YOUR ACCOUNT' : 'WELCOME BACK'}</span>
          <h2>{magic ? 'Sign in with your inbox.' : mode === 'signup' ? 'Start feeling mellow.' : 'Good to see you.'}</h2>
          <p>{magic ? 'We will email you a one-time secure link.' : mode === 'signup' ? 'A few details, then your dashboard is ready.' : 'Enter your details to continue to your account.'}</p>

          {!magic && <div className="auth-tabs" role="tablist" aria-label="Authentication mode"><button type="button" role="tab" aria-selected={mode === 'signin'} className={mode === 'signin' ? 'active' : ''} onClick={() => switchMode('signin')}>Sign in</button><button type="button" role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'active' : ''} onClick={() => switchMode('signup')}>Create account</button></div>}

          <form className="auth-form" onSubmit={submit} noValidate>
            {!magic && mode === 'signup' && <label>Full name<div className="auth-input"><input type="text" autoComplete="name" placeholder="Alex Morgan" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></div></label>}
            <label>Email address<div className="auth-input"><Mail size={18} /><input type="email" autoComplete="email" placeholder="you@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div></label>
            {!magic && <label>Password<div className="auth-input"><LockKeyhole size={18} /><input type={showPassword ? 'text' : 'password'} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} placeholder="At least 8 characters" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>}

            {message.text && <div className={`auth-message auth-message--${message.type}`} role={message.type === 'error' ? 'alert' : 'status'}>{message.type === 'success' && <CheckCircle2 size={18} />}<span>{message.text}</span></div>}
            <button className="auth-submit" type="submit" disabled={processing}>{processing ? <ButtonLoader label={magic ? 'Sending link' : 'Securing session'} /> : <>{submitLabel}<ArrowRight size={18} /></>}</button>
          </form>

          <button className="magic-toggle" type="button" onClick={() => { setMagic(!magic); setMessage({ type: '', text: '' }) }}>{magic ? 'Use email and password instead' : 'Or, continue with a magic link'}<ArrowRight size={15} /></button>
          <div className="auth-privacy"><ShieldCheck size={16} /><span>Your session is managed by Supabase Auth. Mellora never receives a service-role key.</span></div>
        </div>
      </section>
    </main>
  )
}

export function AuthCallback() {
  const { user, loading } = useAuth()
  const [timedOut, setTimedOut] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setTimedOut(true), 7000)
    return () => window.clearTimeout(timer)
  }, [])
  if (!loading && user) return <Navigate to="/dashboard" replace />
  if (timedOut && !user) return <main className="access-denied"><Mail size={44} /><h1>We could not complete sign-in.</h1><p>The link may have expired. Return to the auth page and request a new one.</p><Link className="button button--green" to="/auth">Back to sign in</Link></main>
  return <Loader fullScreen label="Completing your secure sign-in" />
}
