/**
 * Broker realtime del servidor.
 *
 * Mantiene UNA conexión Postgres dedicada en LISTEN sobre los canales
 * wacrm_changes (triggers notify_change — ver migración 0003) y
 * wacrm_broadcast (mensajes de aplicación). Rehidrata la fila con los
 * privilegios del pool y reparte el evento solo a los suscriptores SSE
 * autorizados: mismo account, y para notifications además mismo user.
 *
 * Funciona con N instancias de la app: cada una escucha NOTIFY, así
 * que un cambio hecho en una instancia llega a los SSE de todas.
 */
import { Client } from 'pg';
import { getPool } from '@/lib/db/pool';
import type { ChangeEvent, NotifyPayload, RealtimeEvent } from './shared';

export interface Subscriber {
  userId: string;
  accountId: string;
  send: (event: RealtimeEvent) => void;
}

/** Tablas con trigger notify_change; clave primaria para rehidratar. */
const WATCHED_TABLES: Record<string, string> = {
  messages: 'id',
  conversations: 'id',
  notifications: 'id',
  member_presence: 'user_id',
};

class RealtimeBroker {
  private subscribers = new Set<Subscriber>();
  private listener: Client | null = null;
  private starting = false;
  private reconnectDelayMs = 1000;

  subscribe(subscriber: Subscriber): () => void {
    this.subscribers.add(subscriber);
    void this.ensureListener();
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  private async ensureListener() {
    if (this.listener || this.starting) return;
    this.starting = true;
    try {
      const client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl:
          process.env.DATABASE_SSL === 'true'
            ? { rejectUnauthorized: false }
            : undefined,
      });
      client.on('error', () => this.restartListener());
      client.on('end', () => this.restartListener());
      client.on('notification', (msg) => {
        void this.handleNotification(msg.channel, msg.payload ?? '');
      });
      await client.connect();
      await client.query('LISTEN wacrm_changes');
      await client.query('LISTEN wacrm_broadcast');
      this.listener = client;
      this.reconnectDelayMs = 1000;
    } catch (err) {
      console.error('[realtime] no pude iniciar el listener:', err);
      this.scheduleReconnect();
    } finally {
      this.starting = false;
    }
  }

  private restartListener() {
    if (!this.listener) return;
    this.listener.removeAllListeners();
    this.listener.end().catch(() => {});
    this.listener = null;
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.subscribers.size === 0) return;
    setTimeout(() => void this.ensureListener(), this.reconnectDelayMs);
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 15_000);
  }

  private async handleNotification(channel: string, raw: string) {
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }

    if (channel === 'wacrm_broadcast') {
      const b = payload as {
        channel: string;
        event: string;
        payload: unknown;
        account_id: string;
      };
      this.fanOut(
        {
          type: 'broadcast',
          channel: b.channel,
          event: b.event,
          payload: b.payload,
        },
        { accountId: b.account_id }
      );
      return;
    }

    const change = payload as NotifyPayload;
    const pk = WATCHED_TABLES[change.table];
    if (!pk) return;

    let newRow: Record<string, unknown> = {};
    if (change.op !== 'DELETE') {
      try {
        const { rows } = await getPool().query(
          `SELECT to_jsonb(t) AS row FROM "${change.table}" t WHERE "${pk}" = $1`,
          [change.id]
        );
        if (rows.length === 0) return; // la fila ya no existe
        newRow = rows[0].row;
      } catch (err) {
        console.error('[realtime] fallo la rehidratación:', err);
        return;
      }
    }

    const event: ChangeEvent = {
      type: 'change',
      table: change.table,
      op: change.op,
      new: newRow,
      old:
        change.op === 'DELETE'
          ? {
              [pk]: change.id,
              ...(change.user_id ? { user_id: change.user_id } : {}),
            }
          : { [pk]: change.id },
    };

    this.fanOut(event, {
      accountId: change.account_id,
      userId: change.table === 'notifications' ? change.user_id : null,
    });
  }

  private fanOut(
    event: RealtimeEvent,
    scope: { accountId: string | null; userId?: string | null }
  ) {
    for (const sub of this.subscribers) {
      if (scope.accountId && sub.accountId !== scope.accountId) continue;
      if (scope.userId && sub.userId !== scope.userId) continue;
      try {
        sub.send(event);
      } catch {
        this.subscribers.delete(sub);
      }
    }
  }
}

// Singleton resistente a HMR en dev.
const globalBroker = globalThis as unknown as {
  __wacrmBroker?: RealtimeBroker;
};

export function getBroker(): RealtimeBroker {
  globalBroker.__wacrmBroker ??= new RealtimeBroker();
  return globalBroker.__wacrmBroker;
}
