import { LogoMark } from './Logo'

export function ButtonLoader({ label = 'Processing' }) {
  return <span className="button-loader"><i /><i /><i /><span>{label}</span></span>
}

export default function Loader({ label = 'Getting everything ready', fullScreen = false, compact = false }) {
  return (
    <div className={`mellora-loader ${fullScreen ? 'mellora-loader--screen' : ''} ${compact ? 'mellora-loader--compact' : ''}`} role="status" aria-live="polite">
      <div className="loader-orbit" aria-hidden="true">
        <span className="loader-ring loader-ring--one" />
        <span className="loader-ring loader-ring--two" />
        <span className="loader-dot" />
        <LogoMark inverse size={compact ? 42 : 62} />
      </div>
      <strong>{label}</strong>
      <span className="loader-caption">Money, made mellow.</span>
    </div>
  )
}
