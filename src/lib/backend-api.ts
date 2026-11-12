import { supabase } from '@/integrations/supabase/client'

const API_BASE = (import.meta.env.VITE_KHETMITRA_API_URL || '').replace(/\/$/, '')

export async function backendPost<T>(path: string, body: unknown = {}): Promise<T> {
  if (!API_BASE) throw new Error('Backend URL is missing. Set VITE_KHETMITRA_API_URL in the frontend environment and rebuild.')
  const { data, error } = await supabase.auth.getSession()
  if (error) throw new Error(error.message)
  const token = data.session?.access_token
  if (!token) throw new Error('Please sign in to use crop advice and fertilizer planning.')
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  const result = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(result.error || `Backend request failed (${response.status}).`)
  return result
}
