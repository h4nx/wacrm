import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';
import { SESSION_COOKIE } from '@/lib/auth/constants';

const BASE = 'https://crm.example.com';

function makeRequest(path: string, withCookie: boolean): NextRequest {
  const request = new NextRequest(new URL(path, BASE));
  if (withCookie) {
    request.cookies.set(SESSION_COOKIE, 'opaque-session-token');
  }
  return request;
}

describe('proxy — chequeos optimistas por cookie de sesión', () => {
  it('redirige a /login una página protegida sin cookie', async () => {
    const response = await proxy(makeRequest('/dashboard', false));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(`${BASE}/login`);
  });

  it('deja pasar una página protegida con cookie (la valida el layout)', async () => {
    const response = await proxy(makeRequest('/inbox', true));
    expect(response.headers.get('location')).toBeNull();
  });

  it('redirige /login → /dashboard cuando ya hay cookie', async () => {
    const response = await proxy(makeRequest('/login', true));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(`${BASE}/dashboard`);
  });

  it('con invite token manda a /join/<token> en vez del dashboard', async () => {
    const response = await proxy(makeRequest('/login?invite=abc123', true));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(`${BASE}/join/abc123`);
  });

  it('no honra el invite en /forgot-password (solo login/signup)', async () => {
    const response = await proxy(
      makeRequest('/forgot-password?invite=abc123', true)
    );
    expect(response.headers.get('location')).toBe(`${BASE}/dashboard`);
  });

  it('corta /api/whatsapp/* con 401 sin cookie', async () => {
    const response = await proxy(makeRequest('/api/whatsapp/send', false));
    expect(response.status).toBe(401);
  });

  it('nunca corta el webhook de WhatsApp (Meta no manda cookies)', async () => {
    const response = await proxy(makeRequest('/api/whatsapp/webhook', false));
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  it('deja pasar páginas públicas sin cookie', async () => {
    const response = await proxy(makeRequest('/login', false));
    expect(response.headers.get('location')).toBeNull();
  });
});
