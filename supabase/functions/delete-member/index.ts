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

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return json({ error: 'Authentication is required.' }, 401)

    const { userId } = await request.json()
    if (!userId || typeof userId !== 'string') return json({ error: 'A member ID is required.' }, 400)

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ error: 'Server authentication is not configured.' }, 500)

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
    })
    const { data: { user: caller }, error: authError } = await callerClient.auth.getUser()
    if (authError || !caller) return json({ error: 'Invalid administrator session.' }, 401)
    if (caller.id === userId) return json({ error: 'You cannot delete your own active administrator account.' }, 400)

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: adminProfile, error: profileError } = await adminClient
      .from('profiles')
      .select('role')
      .eq('id', caller.id)
      .maybeSingle()
    if (profileError || adminProfile?.role !== 'admin') {
      return json({ error: 'Administrator permission is required.' }, 403)
    }

    const { data: targetProfile, error: targetError } = await adminClient
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .maybeSingle()
    if (targetError || !targetProfile) return json({ error: 'Member profile not found.' }, 404)

    const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId)
    if (deleteError) return json({ error: deleteError.message }, 500)
    return json({ deleted: true, userId })
  } catch (error) {
    console.error('Member deletion error', error)
    return json({ error: 'The member could not be deleted.' }, 500)
  }
})
