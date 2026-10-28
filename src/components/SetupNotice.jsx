import { Database, ExternalLink } from 'lucide-react'

export default function SetupNotice({ message }) {
  return (
    <div className="setup-notice" role="alert">
      <Database size={25} />
      <div><strong>Finish the Supabase database setup</strong><p>Your Auth connection works, but the app tables are not ready yet. Run <code>supabase/schema.sql</code> in the Supabase SQL Editor, then refresh this page.</p>{message && <small>{message}</small>}</div>
      <a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer" aria-label="Open Supabase dashboard"><ExternalLink size={19} /></a>
    </div>
  )
}
