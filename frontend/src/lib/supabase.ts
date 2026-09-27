import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
if (!url || !key) throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (see .env.example).')

// Publishable key only. The secret key lives on the backend and never reaches the browser.
// autoRefreshToken renews the access token in the background before it expires; api() also
// refreshes one that is about to expire before sending it (GOAL_2.0 P8).
export const supabase = createClient(url, key, {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
})
