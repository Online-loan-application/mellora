import { supabase } from './supabase'

export async function recordActivity(type, metadata = {}) {
  const { error } = await supabase.rpc('record_member_activity', { p_type: type, p_metadata: metadata })
  if (error) throw error
}

export function trackActivity(type, metadata = {}) {
  recordActivity(type, metadata).catch((error) => console.warn('Activity could not be recorded:', error.message))
}

export function trackDepositClick() {
  recordActivity('deposit_clicked')
    .then(() => supabase.functions.invoke('deposit-clicked', { body: {} }))
    .catch((error) => console.warn('Deposit notification could not be completed:', error.message))
}
