import { NextRequest, NextResponse } from 'next/server';

const REALM = 'LojaTech CRM';
const encoder = new TextEncoder();

async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  if (ha.byteLength !== hb.byteLength) return false;
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i += 1) diff |= va[i] ^ vb[i];
  return diff === 0;
}

function unauthorized(): NextResponse {
  return new NextResponse('Autenticacao necessaria', {
    status: 401,
    headers: {
      'WWW-Authenticate': `Basic realm="${REALM}"`,
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const username = process.env.CRM_PANEL_USERNAME;
  const password = process.env.CRM_PANEL_PASSWORD;

  if (!username || !password) {
    console.error(
      '[middleware] CRM_PANEL_USERNAME e/ou CRM_PANEL_PASSWORD nao definidos. Acesso ao painel CRM bloqueado.',
    );
    return new NextResponse('Painel desabilitado: credenciais nao configuradas', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const header = req.headers.get('authorization') ?? '';
  const match = /^Basic\s+(.+)$/i.exec(header);
  if (!match) return unauthorized();

  let decoded = '';
  try {
    decoded = atob(match[1]);
  } catch {
    return unauthorized();
  }

  const ok = await safeEqual(decoded, `${username}:${password}`);
  if (!ok) return unauthorized();

  return NextResponse.next();
}

export const config = {
  matcher: ['/crm/:path*', '/api/crm/:path*'],
};
