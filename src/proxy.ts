import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth/constants';

/**
 * Chequeos OPTIMISTAS por presencia de cookie (el proxy corre en
 * el edge runtime, sin acceso a Postgres — guía oficial de Next 16:
 * no usarlo como capa de sesión). La verificación real ocurre en el
 * server layout del dashboard (redirect si la sesión no valida) y en
 * cada route handler / RLS de la capa de datos.
 */
export async function proxy(request: NextRequest) {
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE);
  const { pathname } = request.nextUrl;

  // Páginas de auth: si ya hay sesión, al dashboard — salvo que venga
  // un invite token, que manda a /join/<token> para aceptarlo.
  if (
    hasSessionCookie &&
    (pathname === '/login' ||
      pathname === '/signup' ||
      pathname === '/forgot-password')
  ) {
    const url = request.nextUrl.clone();
    const inviteToken = request.nextUrl.searchParams.get('invite');
    if (inviteToken && (pathname === '/login' || pathname === '/signup')) {
      url.pathname = `/join/${encodeURIComponent(inviteToken)}`;
      url.search = '';
    } else {
      url.pathname = '/dashboard';
      url.search = '';
    }
    return NextResponse.redirect(url);
  }

  // Páginas protegidas: sin cookie no hay nada que validar — a /login.
  const protectedPaths = [
    '/dashboard',
    '/inbox',
    '/contacts',
    '/pipelines',
    '/broadcasts',
    '/automations',
    '/settings',
  ];
  if (
    !hasSessionCookie &&
    protectedPaths.some((path) => pathname.startsWith(path))
  ) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // API de WhatsApp (no el webhook): corta temprano sin cookie. Los
  // handlers igual validan la sesión — esto solo ahorra trabajo.
  if (
    !hasSessionCookie &&
    pathname.startsWith('/api/whatsapp/') &&
    !pathname.includes('/webhook')
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
