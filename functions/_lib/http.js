export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}

export async function readJson(request) {
  const type = request.headers.get('content-type') || '';
  if (!type.includes('application/json')) throw new Error('JSON body required');
  return await request.json();
}

export function clean(value, max = 4000) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}

export function validDate(value) {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? String(value) : null;
}
