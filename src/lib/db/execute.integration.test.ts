/**
 * Tests de integración de la capa de datos portable contra un
 * PostgreSQL real con el esquema aplicado (db/migrations/*).
 *
 *   TEST_DATABASE_URL=postgres://… npm test
 *
 * Sin TEST_DATABASE_URL la suite se omite (CI sin base). Crea sus
 * propios usuarios/cuentas vía el trigger on_user_created y limpia al
 * final.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DbClient } from './builder';
import type { Descriptor } from './types';

const TEST_URL = process.env.TEST_DATABASE_URL;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pool: any;
let executeDescriptor: typeof import('./execute').executeDescriptor;

let aliceId = '';
let aliceAccountId = '';
let bobId = '';
let contactId = '';

function clientFor(userId?: string): DbClient {
  return new DbClient((d: Descriptor) => executeDescriptor(d, { userId }));
}

describe.skipIf(!TEST_URL)('capa de datos portable (Postgres real)', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL;
    const poolModule = await import('./pool');
    pool = poolModule.getPool();
    ({ executeDescriptor } = await import('./execute'));

    const stamp = Date.now();
    const alice = await pool.query(
      `INSERT INTO users (email, raw_user_meta_data) VALUES ($1, '{"full_name":"Alice"}') RETURNING id`,
      [`alice-${stamp}@test.dev`]
    );
    aliceId = alice.rows[0].id;
    const bob = await pool.query(
      `INSERT INTO users (email, raw_user_meta_data) VALUES ($1, '{"full_name":"Bob"}') RETURNING id`,
      [`bob-${stamp}@test.dev`]
    );
    bobId = bob.rows[0].id;
    const profile = await pool.query(
      `SELECT account_id FROM profiles WHERE user_id = $1`,
      [aliceId]
    );
    aliceAccountId = profile.rows[0].account_id;
  });

  afterAll(async () => {
    if (!pool) return;
    // accounts.owner_user_id es ON DELETE RESTRICT: primero la cuenta.
    await pool.query(`DELETE FROM accounts WHERE owner_user_id = ANY($1)`, [
      [aliceId, bobId],
    ]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [
      [aliceId, bobId],
    ]);
  });

  it('insert + select respetando RLS (la cuenta ajena no ve nada)', async () => {
    const db = clientFor(aliceId);
    const { data: inserted, error } = await db
      .from('contacts')
      .insert({
        user_id: aliceId,
        account_id: aliceAccountId,
        phone: '+51999000111',
        name: 'Cliente Uno',
      })
      .select('id, name')
      .single();
    expect(error).toBeNull();
    expect(inserted.name).toBe('Cliente Uno');
    contactId = inserted.id;

    const { data: mine } = await clientFor(aliceId)
      .from('contacts')
      .select('*');
    expect(mine.map((c: { id: string }) => c.id)).toContain(contactId);

    const { data: theirs } = await clientFor(bobId)
      .from('contacts')
      .select('*');
    expect(theirs).toEqual([]);
  });

  it('embed M:1 (conversations → contact:contacts(...))', async () => {
    const db = clientFor(aliceId);
    const { data: conv, error: convError } = await db
      .from('conversations')
      .insert({
        user_id: aliceId,
        account_id: aliceAccountId,
        contact_id: contactId,
        status: 'open',
      })
      .select('id')
      .single();
    expect(convError).toBeNull();

    const { data, error } = await db
      .from('conversations')
      .select('id, status, contact:contacts(id, name, phone)')
      .eq('id', conv.id)
      .single();
    expect(error).toBeNull();
    expect(data.contact.name).toBe('Cliente Uno');
  });

  it('embed 1:M anidado (contacts → contact_tags(tags(*)))', async () => {
    const db = clientFor(aliceId);
    const { data: tag } = await db
      .from('tags')
      .insert({
        user_id: aliceId,
        account_id: aliceAccountId,
        name: 'vip',
        color: '#f00',
      })
      .select('id')
      .single();
    await db
      .from('contact_tags')
      .insert({ contact_id: contactId, tag_id: tag.id });

    const { data, error } = await db
      .from('contacts')
      .select('id, name, contact_tags(tags(id, name))')
      .eq('id', contactId)
      .single();
    expect(error).toBeNull();
    expect(data.contact_tags).toHaveLength(1);
    expect(data.contact_tags[0].tags.name).toBe('vip');
  });

  it('!inner con filtro punteado filtra la fila base', async () => {
    const db = clientFor(aliceId);
    const { data: withTag } = await db
      .from('contacts')
      .select('id, tag_filter:contact_tags!inner(tag_id)')
      .eq('id', contactId);
    expect(withTag).toHaveLength(1);

    const { data: withOtherTag } = await db
      .from('contacts')
      .select('id, tag_filter:contact_tags!inner(tag_id)')
      .eq('id', contactId)
      .eq('tag_filter.tag_id', '00000000-0000-0000-0000-000000000000');
    expect(withOtherTag).toEqual([]);
  });

  it('.or() con and() anidado (keyset pagination)', async () => {
    const db = clientFor(aliceId);
    const { data: row } = await db
      .from('contacts')
      .select('id, created_at')
      .eq('id', contactId)
      .single();
    const { data, error } = await db
      .from('contacts')
      .select('id')
      .or(
        `created_at.lt.${row.created_at},and(created_at.eq.${row.created_at},id.lt.${row.id})`
      );
    expect(error).toBeNull();
    // El propio cursor queda excluido (estrictamente "después").
    expect(data.map((r: { id: string }) => r.id)).not.toContain(contactId);
  });

  it('.or() con ilike y comodines * → %', async () => {
    const db = clientFor(aliceId);
    const { data } = await db
      .from('contacts')
      .select('id')
      .or(`name.ilike.*iente*,phone.ilike.*000000*`);
    expect(data.map((r: { id: string }) => r.id)).toContain(contactId);
  });

  it('count exact + head', async () => {
    const { count, data } = await clientFor(aliceId)
      .from('contacts')
      .select('id', { count: 'exact', head: true });
    expect(count).toBeGreaterThanOrEqual(1);
    expect(data).toBeNull();
  });

  it('update con .select().single() y upsert con onConflict', async () => {
    const db = clientFor(aliceId);
    const { data, error } = await db
      .from('contacts')
      .update({ company: 'ACME' })
      .eq('id', contactId)
      .select('id, company')
      .single();
    expect(error).toBeNull();
    expect(data.company).toBe('ACME');

    const { data: upserted, error: upsertError } = await db
      .from('contacts')
      .upsert(
        {
          id: contactId,
          user_id: aliceId,
          account_id: aliceAccountId,
          phone: '+51999000111',
          name: 'Cliente Uno v2',
        },
        { onConflict: 'id' }
      )
      .select('id, name')
      .single();
    expect(upsertError).toBeNull();
    expect(upserted.name).toBe('Cliente Uno v2');

    // member_presence NO es escribible directo ni para el dueño — solo
    // vía el RPC touch_presence (igual que en la era Supabase).
    const { error: presenceError } = await db.from('member_presence').upsert(
      {
        user_id: aliceId,
        account_id: aliceAccountId,
        status: 'online',
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );
    expect(presenceError?.code).toBe('42501');
  });

  it('single() sin filas → PGRST116; maybeSingle() → null', async () => {
    const ghost = '00000000-0000-0000-0000-000000000001';
    const { error } = await clientFor(aliceId)
      .from('contacts')
      .select('*')
      .eq('id', ghost)
      .single();
    expect(error?.code).toBe('PGRST116');

    const { data, error: maybeError } = await clientFor(aliceId)
      .from('contacts')
      .select('*')
      .eq('id', ghost)
      .maybeSingle();
    expect(maybeError).toBeNull();
    expect(data).toBeNull();
  });

  it('violación de unique llega con code 23505', async () => {
    const db = clientFor(aliceId);
    const { error } = await db
      .from('contact_tags')
      .insert([{ contact_id: contactId, tag_id: await firstTagId(db) }]);
    expect(error?.code).toBe('23505');
  });

  it('rpc void (touch_presence) y rpc escalar (is_account_member)', async () => {
    const db = clientFor(aliceId);
    const { error } = await db.rpc('touch_presence', { p_status: 'away' });
    expect(error).toBeNull();

    const { data: isMember } = await db.rpc('is_account_member', {
      target_account_id: aliceAccountId,
      min_role: 'owner',
    });
    expect(isMember).toBe(true);

    const { data: bobIsMember } = await clientFor(bobId).rpc(
      'is_account_member',
      {
        target_account_id: aliceAccountId,
        min_role: 'viewer',
      }
    );
    expect(bobIsMember).toBe(false);
  });

  it('delete con count exact', async () => {
    const db = clientFor(aliceId);
    const { data: note } = await db
      .from('contact_notes')
      .insert({
        contact_id: contactId,
        user_id: aliceId,
        account_id: aliceAccountId,
        note_text: 'borrar',
      })
      .select('id')
      .single();
    const { count, error } = await db
      .from('contact_notes')
      .delete({ count: 'exact' })
      .eq('id', note.id);
    expect(error).toBeNull();
    expect(count).toBe(1);
  });

  it('sin userId (service) evade RLS, como el service-role', async () => {
    const { data } = await clientFor(undefined).from('contacts').select('id');
    expect(data.map((r: { id: string }) => r.id)).toContain(contactId);
  });
});

async function firstTagId(db: DbClient): Promise<string> {
  const { data } = await db.from('tags').select('id').limit(1).single();
  return data.id;
}
