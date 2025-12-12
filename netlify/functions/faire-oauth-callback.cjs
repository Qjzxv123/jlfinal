// netlify/functions/faire-oauth-callback.cjs
const crypto = require('crypto');

exports.handler = async (event) => {
  // centralize safe redirect helper
  const safeRedirect = (reason) => ({
    statusCode: 302,
    headers: {
      Location: `/ecommerce-oauth.html${reason ? `?error=${encodeURIComponent(reason)}` : ''}`,
      'Cache-Control': 'no-store',
    },
    body: '',
  });

  try {
    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, headers: { Allow: 'GET' }, body: 'Method Not Allowed' };
    }

    const rawUrl =
      event.rawUrl ||
      event.headers?.['x-original-url'] ||
      // fallback: reconstruct (best effort)
      `https://${event.headers?.host || 'localhost'}${event.path || ''}${event.rawQuery ? `?${event.rawQuery}` : ''}`;

    const urlObj = new URL(rawUrl);
    const authorizationCode =
      urlObj.searchParams.get('code') ||
      urlObj.searchParams.get('authorization_code');

    const state = urlObj.searchParams.get('state') || '';
    let decodedState = {};
    if (!authorizationCode) {
      return safeRedirect('missing_code');
    }

    // Fail fast on env
    const applicationId = process.env.FAIRE_CLIENT_ID;
    const applicationSecret = process.env.FAIRE_CLIENT_SECRET;
    const redirectUrl = process.env.FAIRE_REDIRECT_URI;
    if (!applicationId || !applicationSecret || !redirectUrl) {
      // Don’t leak config problems to the user
      console.error('[ERROR] Missing Faire OAuth env vars');
      return safeRedirect('server_config');
    }

    // Parse state; don’t crash on garbage
    try {
      if (state) decodedState = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
    } catch (e) {
      console.warn('[WARN] Bad state decode');
      return safeRedirect('bad_state');
    }

    // OPTIONAL but strongly recommended: verify state integrity
    // Expect decodedState = { nonce, ts, sig } where sig = HMAC_SHA256(nonce + '.' + ts, STATE_SECRET)
    // This prevents CSRF/state tampering without server session storage.
    const STATE_SECRET = process.env.OAUTH_STATE_HMAC_SECRET;
    if (STATE_SECRET) {
      try {
        const { nonce, ts, sig } = decodedState || {};
        const base = `${nonce}.${ts}`;
        const expected = crypto.createHmac('sha256', STATE_SECRET).update(base).digest('hex');
        if (!nonce || !ts || !sig || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) {
          console.warn('[WARN] State HMAC verification failed');
          return safeRedirect('state_verify');
        }
        // (Optional) freshness check: reject states older than 10 minutes
        if (Math.abs(Date.now() - Number(ts)) > 10 * 60 * 1000) {
          console.warn('[WARN] State expired');
          return safeRedirect('state_expired');
        }
      } catch {
        return safeRedirect('state_verify');
      }
    }

    const user_id = decodedState.user_id || null;
    const display_name = decodedState.user_display_name || null;

    // Scope formatting: switch to string if provider requires it
    const scopeArray = (process.env.FAIRE_OAUTH_SCOPE
      ? process.env.FAIRE_OAUTH_SCOPE.split(/[,\s]+/).filter(Boolean)
      : [
          'READ_ORDERS',
          'WRITE_ORDERS',
          'READ_PRODUCTS',
          'WRITE_PRODUCTS',
          'READ_INVENTORIES',
          'WRITE_INVENTORIES',
          'READ_BRAND',
          'READ_RETAILER',
          'READ_SHIPMENTS',
          'WRITE_SHIPMENTS',
        ]);
    // If Faire expects a string, join here:
    const scope = Array.isArray(scopeArray) ? scopeArray : [String(scopeArray)];
    const scopeForApi = Array.isArray(scope) ? scope.join(' ') : String(scope); // <-- change to ',' if spec says comma

    // Exchange code for token — never leak body/token to logs
    let tokenData;
    try {
      const tokenResponse = await fetch('https://www.faire.com/api/external-api-oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          application_token: applicationId,
          application_secret: applicationSecret,
          redirect_url: redirectUrl,
          scope: scopeForApi,
          grant_type: 'AUTHORIZATION_CODE',
          authorization_code: authorizationCode,
        }),
      });

      const raw = await tokenResponse.text();
      try { tokenData = JSON.parse(raw); } catch { tokenData = { _raw: raw }; }

      if (!tokenResponse.ok || !tokenData?.access_token) {
        console.error('[ERROR] Token exchange failed, status:', tokenResponse.status);
        return safeRedirect('token_exchange_failed');
      }
    } catch (err) {
      console.error('[ERROR] Token exchange error:', err?.message || err);
      return safeRedirect('token_exchange_error');
    }

    // Persist token
    try {
      const { saveTokenRow } = require('./faire-token-utils.cjs');
      let expires_at = null;
      if (tokenData.expires_in) {
        expires_at = Date.now() + tokenData.expires_in * 1000;
      }
      await saveTokenRow(state, {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || null,
        expires_at,
        user_key: display_name || null,
        UserID: user_id || null,
      });
    } catch (e) {
      console.error('[ERROR] saveTokenRow failed:', e?.message || e);
      // still redirect; don’t strand the user
      return safeRedirect('persist_failed');
    }

    return safeRedirect('success');
  } catch (e) {
    console.error('[ERROR] unexpected:', e?.message || e);
    return safeRedirect('unexpected');
  }
};
