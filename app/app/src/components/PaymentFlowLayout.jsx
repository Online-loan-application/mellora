import { ArrowLeft, Check } from 'lucide-react'
import { Link } from 'react-router'
import AppShell from './AppShell'

export default function PaymentFlowLayout({ title, eyebrow, steps = [], currentStep = 0, children }) {
  return (
    <AppShell title={title} eyebrow={eyebrow}>
      <div className="payment-flow">
        <Link className="payment-back" to="/dashboard"><ArrowLeft size={17} />Back to dashboard</Link>
        {steps.length > 0 && (
          <ol className="payment-steps" aria-label="Transfer progress">
            {steps.map((label, index) => {
              const complete = index < currentStep
              const current = index === currentStep
              return (
                <li key={label} className={complete ? 'complete' : current ? 'current' : ''} aria-current={current ? 'step' : undefined}>
                  <span>{complete ? <Check size={13} /> : index + 1}</span>
                  <small>{label}</small>
                </li>
              )
            })}
          </ol>
        )}
        {children}
      </div>
    </AppShell>
  )
}
