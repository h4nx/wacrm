import { createServiceClient, type ServiceClient } from '@/lib/supabase/server'

// Cliente compartido con privilegios de servicio (antes: service-role
// de Supabase). El webhook entrante no tiene usuario en sesión, así
// que el motor lee config/estado y envía con el dueño del esquema —
// las políticas RLS no aplican en este camino, igual que antes.
export function supabaseAdmin(): ServiceClient {
  return createServiceClient()
}
