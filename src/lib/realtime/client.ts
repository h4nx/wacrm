/**
 * Cliente realtime del navegador — reemplaza los canales de Supabase
 * con un EventSource compartido sobre /api/realtime/sse.
 *
 * Reproduce la superficie usada por la app:
 *   client.channel(name)
 *     .on('postgres_changes', { table, filter? }, cb)
 *     .on('broadcast', { event }, cb)
 *     .subscribe(cb?)
 *   channel.send({ type: 'broadcast', event, payload })
 *   client.removeChannel(channel)
 */
import type { RealtimeEvent } from './shared';

interface PostgresChangesFilter {
  event?: '*' | 'INSERT' | 'UPDATE' | 'DELETE';
  schema?: string;
  table: string;
  /** Sintaxis PostgREST: 'columna=eq.valor'. */
  filter?: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- supabase-js
   entrega new/old como objetos sin tipar; los hooks castean. */
interface PostgresChangesPayload {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: any;
  old: any;
}

type ChangesCallback = (payload: PostgresChangesPayload) => void;
type BroadcastCallback = (message: { event: string; payload: unknown }) => void;
type SubscribeStatus = 'SUBSCRIBED' | 'CLOSED' | 'CHANNEL_ERROR';

interface ChangesBinding {
  kind: 'postgres_changes';
  filter: PostgresChangesFilter;
  callback: ChangesCallback;
}

interface BroadcastBinding {
  kind: 'broadcast';
  event: string;
  callback: BroadcastCallback;
}

function parseFilter(
  filter: string | undefined
): { column: string; value: string } | null {
  if (!filter) return null;
  const match = filter.match(/^([a-zA-Z_][a-zA-Z0-9_]*)=eq\.(.*)$/);
  if (!match) {
    console.warn(`[realtime] filtro no soportado, se ignora: ${filter}`);
    return null;
  }
  return { column: match[1], value: match[2] };
}

export class RealtimeChannel {
  private bindings: (ChangesBinding | BroadcastBinding)[] = [];
  private statusCallback:
    ((status: SubscribeStatus, err?: Error) => void) | null = null;
  subscribed = false;

  constructor(
    public readonly name: string,
    private manager: RealtimeManager
  ) {}

  on(
    type: 'postgres_changes',
    filter: PostgresChangesFilter,
    callback: ChangesCallback
  ): this;
  on(
    type: 'broadcast',
    filter: { event: string },
    callback: BroadcastCallback
  ): this;
  on(
    type: 'postgres_changes' | 'broadcast',
    filter: PostgresChangesFilter | { event: string },
    callback: ChangesCallback | BroadcastCallback
  ): this {
    if (type === 'postgres_changes') {
      this.bindings.push({
        kind: 'postgres_changes',
        filter: filter as PostgresChangesFilter,
        callback: callback as ChangesCallback,
      });
    } else {
      this.bindings.push({
        kind: 'broadcast',
        event: (filter as { event: string }).event,
        callback: callback as BroadcastCallback,
      });
    }
    return this;
  }

  subscribe(callback?: (status: SubscribeStatus, err?: Error) => void): this {
    this.statusCallback = callback ?? null;
    this.manager.attach(this);
    return this;
  }

  async send(message: { type: 'broadcast'; event: string; payload?: unknown }) {
    try {
      await fetch('/api/realtime/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: this.name,
          event: message.event,
          payload: message.payload ?? null,
        }),
      });
      return 'ok' as const;
    } catch {
      return 'error' as const;
    }
  }

  unsubscribe(): Promise<'ok'> {
    this.manager.detach(this);
    return Promise.resolve('ok');
  }

  /** Interno: entrega un evento SSE a los bindings que correspondan. */
  deliver(event: RealtimeEvent) {
    for (const binding of this.bindings) {
      if (binding.kind === 'broadcast' && event.type === 'broadcast') {
        if (event.channel !== this.name) continue;
        if (binding.event !== event.event && binding.event !== '*') continue;
        binding.callback({ event: event.event, payload: event.payload });
      }
      if (binding.kind === 'postgres_changes' && event.type === 'change') {
        if (binding.filter.table !== event.table) continue;
        const wanted = binding.filter.event ?? '*';
        if (wanted !== '*' && wanted !== event.op) continue;
        const eq = parseFilter(binding.filter.filter);
        if (eq && event.op !== 'DELETE') {
          const value = (event.new as Record<string, unknown>)[eq.column];
          if (String(value) !== eq.value) continue;
        }
        binding.callback({
          eventType: event.op,
          new: event.new,
          old: event.old,
        });
      }
    }
  }

  /** Interno */
  notifyStatus(status: SubscribeStatus, err?: Error) {
    this.subscribed = status === 'SUBSCRIBED';
    this.statusCallback?.(status, err);
  }
}

class RealtimeManager {
  private channels = new Set<RealtimeChannel>();
  private source: EventSource | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelayMs = 1000;

  channel(name: string): RealtimeChannel {
    return new RealtimeChannel(name, this);
  }

  attach(channel: RealtimeChannel) {
    this.channels.add(channel);
    this.ensureConnection();
    if (this.source?.readyState === EventSource.OPEN) {
      channel.notifyStatus('SUBSCRIBED');
    }
  }

  detach(channel: RealtimeChannel) {
    this.channels.delete(channel);
    channel.notifyStatus('CLOSED');
    if (this.channels.size === 0) {
      this.source?.close();
      this.source = null;
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    }
  }

  removeChannel(channel: RealtimeChannel): Promise<'ok'> {
    this.detach(channel);
    return Promise.resolve('ok');
  }

  private ensureConnection() {
    if (this.source || typeof window === 'undefined') return;
    const source = new EventSource('/api/realtime/sse');
    this.source = source;

    source.onopen = () => {
      this.reconnectDelayMs = 1000;
      for (const channel of this.channels) channel.notifyStatus('SUBSCRIBED');
    };

    source.onmessage = (msg) => {
      let event: RealtimeEvent;
      try {
        event = JSON.parse(msg.data) as RealtimeEvent;
      } catch {
        return;
      }
      for (const channel of this.channels) channel.deliver(event);
    };

    source.onerror = () => {
      // EventSource reintenta solo mientras readyState=CONNECTING; si el
      // servidor cerró (CLOSED) programamos reconexión con backoff.
      if (source.readyState === EventSource.CLOSED) {
        this.source = null;
        if (this.channels.size === 0) return;
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.ensureConnection();
        }, this.reconnectDelayMs);
        this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 15_000);
      }
    };
  }
}

export const realtimeManager = new RealtimeManager();
