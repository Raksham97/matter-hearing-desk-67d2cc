const enc = new TextEncoder();

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(value))));
}

async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(value)));
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a[i] ^ b[i];
  return x === 0;
}

export async function passwordMatches(input, expected) {
  if (!input || !expected) return false;
  return constantTimeEqual(await digest(input), await digest(expected));
}

export async function makeSession(secret) {
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 14;
  const nonce = crypto.randomUUID();
  const payload = `${exp}.${nonce}`;
  const sig = await hmac(secret, payload);
  return `${payload}.${sig}`;
}

export async function verifySession(token, secret) {
  if (!token || !secret) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [expRaw, nonce, sig] = parts;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = await hmac(secret, `${expRaw}.${nonce}`);
  return constantTimeEqual(enc.encode(sig), enc.encode(expected));
}

export function getCookie(request, name) {
  const raw = request.headers.get('Cookie') || '';
  for (const pair of raw.split(';')) {
    const [k, ...v] = pair.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export async function requireAuth(context) {
  const token = getCookie(context.request, 'matterdesk_session');
  const ok = await verifySession(token, context.env.AUTH_SECRET);
  if (!ok) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
    });
  }
  return null;
}

export function sessionCookie(token) {
  return `matterdesk_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${60 * 60 * 24 * 14}`;
}

export function clearSessionCookie() {
  return 'matterdesk_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0';
}
