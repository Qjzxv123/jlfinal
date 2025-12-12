// netlify/functions/shopify-webhook.cjs
// Minimal, inert Shopify webhook — HMAC check only.

const crypto = require('crypto');

const HEADERS = {
  'Content-Type': 'text/plain; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
};

const ok = () => ({ statusCode: 200, headers: HEADERS, body: 'ok' });
const bad = (code, msg) => ({ statusCode: code, headers: HEADERS, body: msg });

function timingSafeEq(a, b) {
  const A = Buffer.from(String(a || ''), 'utf8');
  const B = Buffer.from(String(b || ''), 'utf8');
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return bad(405, 'Method Not Allowed');
    }

    const secret = process.env.SHOPIFY_API_SECRET;
    if (!secret) {
      console.error('[shopify-webhook] Missing SHOPIFY_APP_SECRET');
      return bad(500, 'Server not configured');
    }

    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64')
      : Buffer.from(event.body || '', 'utf8');

    const hmac =
      event.headers['x-shopify-hmac-sha256'] ||
      event.headers['X-Shopify-Hmac-Sha256'];

    if (!hmac) {
      return bad(401, 'Missing signature');
    }

    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('base64');

    if (!timingSafeEq(expected, hmac)) {
      return bad(401, 'Invalid signature');
    }

    // Intentionally do nothing.
    // This endpoint exists solely to satisfy Shopify webhook verification.
    return ok();
  } catch {
    // 500 tells Shopify to retry; acceptable for transient failure
    return bad(500, 'handler error');
  }
};
