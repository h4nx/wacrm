/** Contratos compartidos del realtime portable (SSE + LISTEN/NOTIFY). */

export type ChangeOp = 'INSERT' | 'UPDATE' | 'DELETE';

/** Evento de cambio de fila que viaja por SSE al navegador. */
export interface ChangeEvent {
  type: 'change';
  table: string;
  op: ChangeOp;
  /** Fila completa (INSERT/UPDATE); {} en DELETE. */
  new: Record<string, unknown>;
  /** Solo claves conocidas (id / user_id) — como Supabase sin REPLICA FULL. */
  old: Record<string, unknown>;
}

/** Mensaje broadcast de aplicación (p.ej. typing indicators). */
export interface BroadcastEvent {
  type: 'broadcast';
  channel: string;
  event: string;
  payload: unknown;
}

export type RealtimeEvent = ChangeEvent | BroadcastEvent;

/** Payload del pg_notify('wacrm_changes') emitido por los triggers. */
export interface NotifyPayload {
  table: string;
  op: ChangeOp;
  id: string;
  account_id: string | null;
  user_id: string | null;
}
