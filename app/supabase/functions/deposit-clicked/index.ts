import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
}[character] || character))

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return json({ error: 'Authentication is required.' }, 401)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authorization } } },
    )
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return json({ error: 'Invalid member session.' }, 401)

    const resendKey = Deno.env.get('RESEND_API_KEY')
    const adminEmail = Deno.env.get('ADMIN_NOTIFICATION_EMAIL')
    const fromEmail = Deno.env.get('DEPOSIT_EMAIL_FROM')
    if (!resendKey || !adminEmail || !fromEmail) {
      return json({ skipped: true, message: 'Deposit email has not been configured.' })
    }

    const memberName = String(user.user_metadata?.full_name || user.email?.split('@')[0] || 'Mellora member')
    const clickedAt = new Date().toISOString()
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromEmail,
        to: [adminEmail],
        subject: `Mellora deposit clicked — ${memberName}`,
        html: `<div style="font-family:Arial,sans-serif;color:#013E37"><h2>Deposit instructions opened</h2><p><strong>${escapeHtml(memberName)}</strong> (${escapeHtml(user.email || 'No email')}) clicked Deposit.</p><p>Time: ${escapeHtml(clickedAt)}</p><p>Member ID: ${escapeHtml(user.id)}</p></div>`,
        text: `${memberName} (${user.email || 'No email'}) clicked Deposit at ${clickedAt}. Member ID: ${user.id}`,
      }),
    })

    if (!response.ok) {
      const detail = await response.text()
      console.error('Resend delivery failed', response.status, detail)
      return json({ error: 'The admin email could not be delivered.' }, 502)
    }
    return json({ sent: true })
  } catch (error) {
    console.error('Deposit notification error', error)
    return json({ error: 'The deposit notification could not be processed.' }, 500)
  }
})
