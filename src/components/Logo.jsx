import { Link } from 'react-router'

export function LogoMark({ inverse = false, size = 42 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <rect width="48" height="48" rx="14" fill={inverse ? '#FFEFB3' : '#013E37'} />
      <path d="M12 35V15.5C12 13.6 13.3 12.7 14.8 12.7C15.8 12.7 16.5 13.1 17.3 14L24 21.3L30.7 14C31.5 13.1 32.2 12.7 33.2 12.7C34.7 12.7 36 13.6 36 15.5V35H30.4V24.6L25.6 29.1C24.7 30 23.3 30 22.4 29.1L17.6 24.6V35H12Z" fill={inverse ? '#013E37' : '#FFEFB3'} />
    </svg>
  )
}

export default function Logo({ inverse = false, to = '/', compact = false }) {
  return (
    <Link className={`app-logo ${inverse ? 'app-logo--inverse' : ''}`} to={to} aria-label="Mellora home">
      <LogoMark inverse={inverse} size={compact ? 36 : 42} />
      <span>mellora</span>
    </Link>
  )
}
