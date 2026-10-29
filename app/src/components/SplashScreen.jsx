import { useEffect, useState } from 'react'
import { LogoMark } from './Logo'

export default function SplashScreen({ onDone, label = 'Loading Mellora' }) {
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      onDone()
      return undefined
    }
    const leaveTimer = window.setTimeout(() => setLeaving(true), 1080)
    const doneTimer = window.setTimeout(onDone, 1500)
    return () => {
      window.clearTimeout(leaveTimer)
      window.clearTimeout(doneTimer)
    }
  }, [onDone])

  return (
    <div className={`splash ${leaving ? 'splash--leaving' : ''}`} role="status" aria-label={label}>
      <div className="splash__halo" />
      <div className="splash__brand">
        <div className="splash__mark"><LogoMark inverse size={74} /></div>
        <span className="splash__name">mellora</span>
        <span className="splash__tagline">Money, made mellow.</span>
      </div>
      <div className="splash__progress"><span /></div>
    </div>
  )
}
