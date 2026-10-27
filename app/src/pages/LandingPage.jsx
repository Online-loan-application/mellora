import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ArrowDown, ArrowRight, ArrowUpRight, Check, Eye, Fingerprint, LockKeyhole, Menu, Pause, Play, RotateCcw, ShieldCheck, Sparkles, X } from 'lucide-react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

const modes = {
  spend: {
    label: 'Spend',
    title: 'See where it goes.',
    copy: 'A live view of your balance, everyday spending, and recent activity—without making you decode a statement.',
    stat: '$2,840',
    statLabel: 'left to spend this month',
  },
  save: {
    label: 'Save',
    title: 'Grow in the background.',
    copy: 'Round-ups and scheduled transfers gather in one clear savings view, with progress you can understand at a glance.',
    stat: '$8,240',
    statLabel: 'saved toward your goals',
  },
  send: {
    label: 'Send',
    title: 'Move money, minus the friction.',
    copy: 'A focused transfer flow keeps recipients, amounts, and review steps visible from start to finish.',
    stat: '2 taps',
    statLabel: 'to review a repeat transfer',
  },
}

const activities = [
  { name: 'Corner market', category: 'Groceries · Today', amount: '−$24.80' },
  { name: 'Salary deposit', category: 'Income · Today', amount: '+$3,200' },
  { name: 'City transit', category: 'Transport · Yesterday', amount: '−$4.25' },
  { name: 'Round-up transfer', category: 'Savings · Yesterday', amount: '−$1.65' },
]

function LogoMark({ inverse = false, size = 42 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <rect width="48" height="48" rx="14" fill={inverse ? '#FFEFB3' : '#013E37'} />
      <path
        d="M12 35V15.5C12 13.6 13.3 12.7 14.8 12.7C15.8 12.7 16.5 13.1 17.3 14L24 21.3L30.7 14C31.5 13.1 32.2 12.7 33.2 12.7C34.7 12.7 36 13.6 36 15.5V35H30.4V24.6L25.6 29.1C24.7 30 23.3 30 22.4 29.1L17.6 24.6V35H12Z"
        fill={inverse ? '#013E37' : '#FFEFB3'}
      />
    </svg>
  )
}

function Wordmark({ inverse = false }) {
  return (
    <a className={`wordmark ${inverse ? 'wordmark--inverse' : ''}`} href="#top" aria-label="Mellora home">
      <LogoMark inverse={inverse} />
      <span>mellora</span>
    </a>
  )
}

function Splash({ onDone }) {
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      onDone()
      return
    }
    const leaveTimer = window.setTimeout(() => setLeaving(true), 1080)
    const doneTimer = window.setTimeout(onDone, 1500)
    return () => {
      window.clearTimeout(leaveTimer)
      window.clearTimeout(doneTimer)
    }
  }, [onDone])

  return (
    <div className={`splash ${leaving ? 'splash--leaving' : ''}`} role="status" aria-label="Loading Mellora">
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

function LineChart({ compact = false }) {
  return (
    <svg className={`line-chart ${compact ? 'line-chart--compact' : ''}`} viewBox="0 0 520 190" role="img" aria-label="Balance trending upward over seven days">
      <defs>
        <linearGradient id={compact ? 'areaFillCompact' : 'areaFill'} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFEFB3" stopOpacity=".28" />
          <stop offset="100%" stopColor="#FFEFB3" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[35, 80, 125, 170].map((y) => <line key={y} x1="0" y1={y} x2="520" y2={y} className="chart-grid" />)}
      <path className="chart-area" d="M0 155 C45 142 64 151 98 126 C139 96 155 126 199 105 C242 85 265 105 304 74 C350 38 371 74 412 51 C453 28 481 39 520 16 L520 190 L0 190 Z" fill={`url(#${compact ? 'areaFillCompact' : 'areaFill'})`} />
      <path className="chart-line" pathLength="1" d="M0 155 C45 142 64 151 98 126 C139 96 155 126 199 105 C242 85 265 105 304 74 C350 38 371 74 412 51 C453 28 481 39 520 16" />
      <circle className="chart-dot-pulse" cx="520" cy="16" r="10" />
      <circle className="chart-dot" cx="520" cy="16" r="5" />
    </svg>
  )
}

function SavingsOrbit({ large = false }) {
  return (
    <div className={`savings-orbit ${large ? 'savings-orbit--large' : ''}`} aria-label="Animated savings goal graphic" role="img">
      <div className="orbit orbit--outer"><span className="orbit__coin">$</span></div>
      <div className="orbit orbit--inner"><span className="orbit__seed" /></div>
      <div className="savings-orbit__center">
        <span>Travel fund</span>
        <strong>72%</strong>
        <small>$3,600 of $5,000</small>
      </div>
    </div>
  )
}

function HeroPhone({ balance }) {
  return (
    <div className="hero-visual" aria-label="Mellora account preview">
      <div className="hero-visual__glow" />
      <div className="phone-shell hero-reveal">
        <div className="phone-top"><span>9:41</span><span className="phone-notch" /><span>● ●</span></div>
        <div className="phone-greeting"><div><small>Good morning, Alex</small><strong>Your money, today.</strong></div><div className="avatar">A</div></div>
        <div className="balance-block">
          <span>Total balance <Eye size={14} /></span>
          <strong>${balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
          <small><span>↗ 4.8%</span> from last month</small>
        </div>
        <LineChart compact />
        <div className="phone-actions"><span>Send</span><span>Request</span><span>More</span></div>
        <div className="phone-activity"><span>Recent activity</span><strong>View all</strong></div>
        {activities.slice(0, 2).map((item) => (
          <div className="phone-transaction" key={item.name}><span className="transaction-dot" /><div><strong>{item.name}</strong><small>{item.category}</small></div><b>{item.amount}</b></div>
        ))}
      </div>
      <div className="glass-float glass-float--balance hero-reveal">
        <span className="live-pill"><i /> LIVE</span>
        <small>Available to spend</small>
        <strong>$2,840.20</strong>
        <div className="mini-bars">{[42, 65, 48, 78, 60, 88, 72].map((height, index) => <i key={index} style={{ height: `${height}%`, animationDelay: `${index * 90}ms` }} />)}</div>
      </div>
      <div className="glass-float glass-float--saving hero-reveal">
        <div className="mini-ring"><span>72%</span></div>
        <div><small>Travel fund</small><strong>+$18.40</strong><span>this week</span></div>
      </div>
    </div>
  )
}

function ProductDemo({ mode, setMode, activityIndex }) {
  const current = modes[mode]
  return (
    <div className="demo-layout reveal" id="account-demo">
      <div className="demo-copy">
        <div className="mode-tabs" role="tablist" aria-label="Account preview modes">
          {Object.keys(modes).map((item) => (
            <button key={item} role="tab" aria-selected={mode === item} className={mode === item ? 'active' : ''} onClick={() => setMode(item)}>
              {modes[item].label}
            </button>
          ))}
        </div>
        <div className="demo-copy__text" key={mode}>
          <span className="section-index">0{Object.keys(modes).indexOf(mode) + 1}</span>
          <h3>{current.title}</h3>
          <p>{current.copy}</p>
          <div className="demo-stat"><strong>{current.stat}</strong><span>{current.statLabel}</span></div>
        </div>
      </div>
      <div className={`demo-screen demo-screen--${mode}`}>
        <div className="demo-screen__top"><LogoMark inverse size={32} /><span>mellora / {mode}</span><span className="demo-status"><i /> ACCOUNT</span></div>
        {mode === 'spend' && (
          <div className="demo-panel demo-panel--spend" key="spend">
            <div className="demo-balance"><span>Monthly overview</span><strong>$4,260.80</strong><small>Income $6,400 · Spending $2,139.20</small></div>
            <LineChart />
            <div className="demo-activity" key={activityIndex}>
              <span className="activity-icon"><ArrowUpRight size={18} /></span>
              <div><small>Latest activity</small><strong>{activities[activityIndex].name}</strong><span>{activities[activityIndex].category}</span></div>
              <b>{activities[activityIndex].amount}</b>
            </div>
          </div>
        )}
        {mode === 'save' && (
          <div className="demo-panel demo-panel--save" key="save">
            <SavingsOrbit large />
            <div className="roundup-row"><span>Automatic round-ups</span><strong>Active</strong></div>
            <div className="roundup-track"><span /></div>
          </div>
        )}
        {mode === 'send' && (
          <div className="demo-panel demo-panel--send" key="send">
            <div className="transfer-graphic" aria-hidden="true">
              <div className="transfer-person">A</div><div className="transfer-path"><i /><span>$240</span></div><div className="transfer-person transfer-person--to">J</div>
            </div>
            <div className="transfer-details"><span>Repeat transfer</span><strong>Alex <ArrowRight size={18} /> Jordan</strong><small>Today · Review before sending</small></div>
            <div className="transfer-review"><Check size={18} /><span>Recipient and amount ready for your review</span></div>
          </div>
        )}
      </div>
    </div>
  )
}

function LandingPage() {
  const [splash, setSplash] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [mode, setMode] = useState('spend')
  const [activityIndex, setActivityIndex] = useState(0)
  const [balance, setBalance] = useState(0)
  const [replayKey, setReplayKey] = useState(0)
  const [paused, setPaused] = useState(false)
  const root = useRef(null)
  const handleSplashDone = useCallback(() => setSplash(false), [])

  useEffect(() => {
    const node = root.current
    const handleAnchors = (event) => {
      const anchor = event.target.closest('a[href^="#"]')
      if (!anchor || !node?.contains(anchor)) return
      const id = anchor.getAttribute('href')?.slice(1)
      const target = id && document.getElementById(id)
      if (target) {
        event.preventDefault()
        target.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
        setMenuOpen(false)
      }
    }
    node?.addEventListener('click', handleAnchors)
    return () => node?.removeEventListener('click', handleAnchors)
  }, [])

  useEffect(() => {
    document.body.style.overflow = splash ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [splash])

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') setMenuOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      setBalance(12840.62)
      return
    }
    const timeout = window.setTimeout(() => {
      const start = performance.now()
      const tick = (now) => {
        const progress = Math.min((now - start) / 1700, 1)
        const eased = 1 - Math.pow(1 - progress, 4)
        setBalance(12840.62 * eased)
        if (progress < 1) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }, 1450)
    return () => window.clearTimeout(timeout)
  }, [])

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const interval = window.setInterval(() => setActivityIndex((index) => (index + 1) % activities.length), 2800)
    return () => window.clearInterval(interval)
  }, [])

  useLayoutEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const context = gsap.context(() => {
      gsap.from('.hero-reveal', { y: 34, opacity: 0, scale: 0.97, duration: 0.85, stagger: 0.09, delay: 1.38, ease: 'power3.out' })
      gsap.utils.toArray('.reveal').forEach((element) => {
        gsap.fromTo(element, { y: 44, opacity: 0, scale: 0.97 }, {
          y: 0, opacity: 1, scale: 1, duration: 0.72, ease: 'power3.out',
          scrollTrigger: { trigger: element, start: 'top 82%', toggleActions: 'play none none reverse' },
        })
      })
      gsap.fromTo('.flow-word', { opacity: 0.24 }, {
        opacity: 1, stagger: 0.12, ease: 'none',
        scrollTrigger: { trigger: '.manifesto', start: 'top 70%', end: 'bottom 58%', scrub: true },
      })
      gsap.to('.hero-visual', {
        y: -46, ease: 'none',
        scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true },
      })
    }, root)
    return () => context.revert()
  }, [])

  const closeMenu = () => setMenuOpen(false)

  return (
    <div ref={root} className={`site ${paused ? 'motion-paused' : ''}`} id="top">
      {splash && <Splash onDone={handleSplashDone} />}
      <header className="site-header">
        <Wordmark inverse />
        <nav className="desktop-nav" aria-label="Main navigation">
          <a href="#experience">Account</a><a href="#security">Security</a><a href="#motion">Motion</a>
        </nav>
        <Link className="header-cta" to="/auth">Sign in <ArrowUpRight size={15} /></Link>
        <button className="menu-button" aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
          {menuOpen ? <X /> : <Menu />}
        </button>
        {menuOpen && <nav className="mobile-nav" aria-label="Mobile navigation"><a href="#experience" onClick={closeMenu}>Account</a><a href="#security" onClick={closeMenu}>Security</a><Link to="/auth" onClick={closeMenu}>Sign in</Link></nav>}
      </header>

      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-grid" aria-hidden="true" />
          <div className="hero-copy">
            <div className="hero-kicker hero-reveal"><span>DIGITAL BANKING, REIMAGINED</span><i /></div>
            <h1 id="hero-title" className="hero-reveal">Banking that<br /><em>breathes</em> with you.</h1>
            <p className="hero-reveal">Meet Mellora: calm, clear online banking for spending, saving, and sending—designed around your everyday life.</p>
            <div className="hero-actions hero-reveal">
              <a className="button button--butter" href="#experience">Explore the account <ArrowDown size={18} /></a>
            </div>
            <div className="hero-footnote hero-reveal"><ShieldCheck size={17} /><span>Secure access. Clear activity. Everyday control.</span></div>
          </div>
          <HeroPhone balance={balance} />
          <a href="#experience" className="scroll-cue" aria-label="Scroll to account experience"><span>SCROLL TO EXPLORE</span><ArrowDown size={16} /></a>
        </section>

        <div className="ticker" aria-label="Mellora product benefits">
          <div className="ticker__track">
            {[0, 1].map((copy) => <div className="ticker__group" key={copy} aria-hidden={copy === 1}><span>SPEND WITH CLARITY</span><i>✦</i><span>SAVE ON AUTOPILOT</span><i>✦</i><span>SEND WITHOUT FRICTION</span><i>✦</i><span>MONEY, MADE MELLOW</span><i>✦</i></div>)}
          </div>
        </div>

        <section className="experience section" id="experience" aria-labelledby="experience-title">
          <div className="section-heading reveal">
            <span className="eyebrow">YOUR EVERYDAY ACCOUNT</span>
            <h2 id="experience-title">One account.<br />Three calm modes.</h2>
            <p>Switch between account views to see how every banking task gets its own focused, purposeful space.</p>
          </div>
          <ProductDemo mode={mode} setMode={setMode} activityIndex={activityIndex} />
        </section>

        <section className="manifesto section" aria-label="Mellora philosophy">
          <p>
            {['Less', 'bank', 'noise.', 'More', 'life', 'in', 'focus.'].map((word, index) => <span className="flow-word" key={index}>{word} </span>)}
          </p>
          <div className="manifesto__note reveal"><Sparkles size={20} /><span>Warm visuals for the human stuff.<br />Precise graphics for the money stuff.</span></div>
        </section>

        <section className="security section" id="security" aria-labelledby="security-title">
          <div className="security-visual reveal">
            <div className="security-radar"><i /><i /><i /><span className="security-scan" /></div>
            <div className="shield-core"><ShieldCheck size={70} strokeWidth={1.3} /></div>
            <div className="security-chip security-chip--top"><Fingerprint size={20} /><span>Biometric sign-in</span><strong>Ready</strong></div>
            <div className="security-chip security-chip--bottom"><LockKeyhole size={20} /><span>Card controls</span><strong>Visible</strong></div>
          </div>
          <div className="security-copy reveal">
            <span className="eyebrow">SECURITY, IN PLAIN SIGHT</span>
            <h2 id="security-title">Confidence should feel visible.</h2>
            <p>The interface keeps important controls close and explains what is happening—so security feels like part of the experience, not fine print behind it.</p>
            <ul>
              <li><Fingerprint size={23} /><div><strong>Simple, secure sign-in</strong><span>A focused sign-in experience with clear feedback at every step.</span></div></li>
              <li><LockKeyhole size={23} /><div><strong>Card controls up front</strong><span>Freeze, limits, and alerts are presented as everyday tools.</span></div></li>
              <li><ShieldCheck size={23} /><div><strong>Clear review states</strong><span>Transfers show recipients and amounts before confirmation.</span></div></li>
            </ul>
            <small>Clear prompts and visible controls help you stay informed and in control.</small>
          </div>
        </section>

        <section className="motion section" id="motion" aria-labelledby="motion-title">
          <div className="motion-heading reveal">
            <span className="eyebrow">MOTION WITH MEANING</span>
            <h2 id="motion-title">Graphics that<br />explain themselves.</h2>
            <p>Every movement has a job: show change, reveal direction, or make progress tangible.</p>
            <div className="motion-controls">
              <button className="button button--green" onClick={() => setReplayKey((key) => key + 1)}><RotateCcw size={17} /> Replay graphics</button>
              <button className="pause-button" onClick={() => setPaused(!paused)}>{paused ? <Play size={17} /> : <Pause size={17} />}{paused ? 'Resume motion' : 'Pause motion'}</button>
            </div>
          </div>
          <div className="motion-stage reveal" key={replayKey}>
            <div className="motion-stage__header"><span>mellora / automation</span><i /><strong>{paused ? 'PAUSED' : 'RUNNING'}</strong></div>
            <div className="motion-demo motion-demo--count"><span>01 / COUNT</span><strong>$12,840<sup>.62</sup></strong><p>Balances count up to make new value feel tangible.</p></div>
            <div className="motion-demo motion-demo--draw"><span>02 / DRAW</span><LineChart compact /><p>The trend line draws itself to reveal direction over time.</p></div>
            <div className="motion-demo motion-demo--orbit"><span>03 / ORBIT</span><SavingsOrbit /><p>A gentle orbit keeps automated savings visibly in motion.</p></div>
          </div>
        </section>

        <section className="closing section" aria-labelledby="closing-title">
          <div className="closing-mark reveal"><LogoMark size={66} /></div>
          <h2 id="closing-title" className="reveal">Money,<br /><em>made mellow.</em></h2>
          <p className="reveal">A warmer visual language for everyday digital banking.</p>
          <a className="button button--green reveal" href="#top">Back to the beginning <ArrowUpRight size={18} /></a>
        </section>
      </main>

      <footer className="site-footer">
        <div className="footer-main">
          <div className="footer-brand">
            <Wordmark inverse />
            <p>Calm, clear online banking for everyday spending, saving, and sending.</p>
          </div>
          <div className="footer-links">
            <nav className="footer-nav-group" aria-label="Explore Mellora">
              <h2>Explore</h2>
              <a href="#experience">Account</a>
              <a href="#security">Security</a>
              <a href="#motion">Motion</a>
            </nav>
            <nav className="footer-nav-group" aria-label="Mellora account access">
              <h2>Your account</h2>
              <Link to="/auth">Sign in</Link>
              <Link to="/auth?mode=signup">Create account</Link>
              <a href="#top">Back to top</a>
            </nav>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© 2026 Mellora. All rights reserved.</span>
          <span>Money, made mellow.</span>
        </div>
      </footer>
    </div>
  )
}

export default LandingPage
