// netlify/functions/faire-oauth-callback.cjs

const crypto = require('crypto');

exports.handler = async (event) => {
  const REDIRECT_PATH = '/ecommerce-oauth.html';

  const safeRedirect = (reason) => ({
    statusCode: 302,
    headers: {
      Location: reason
        ? `${REDIRECT_PATH}?error=${encodeURIComponent(reason)}`
        : REDIRECT_PATH,
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
      `https://${event.headers?.host || 'localhost'}${event.path || ''}${
        event.rawQuery ? `?${event.rawQuery}` : ''
      }`;

    const urlObj = new URL(rawUrl);

    const authorizationCode =
      urlObj.searchParams.get('code') ||
      urlObj.searchParams.get('authorization_code');

    const state = urlObj.searchParams.get('state') || '';

    if (!authorizationCode) {
      return safeRedirect('missing_code');
    }

    let decodedState = {};
    if (state) {
      try {
        decodedState = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
      } catch {
        return safeRedirect('bad_state');
      }
    }

    // OPTIONAL: HMAC-based state verification
    if (process.env.OAUTH_STATE_HMAC_SECRET && state) {
      try {
        const { nonce, ts, sig } = decodedState || {};
        const base = `${nonce}.${ts}`;
        const expected = crypto
          .createHmac('sha256', process.env.OAUTH_STATE_HMAC_SECRET)
          .update(base)
          .digest('hex');

        if (
          !nonce ||
          !ts ||
          !sig ||
          !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))
        ) {
          return safeRedirect('state_verify');
        }

        // Expire state after 10 minutes
        if (Math.abs(Date.now() - Number(ts)) > 10 * 60 * 1000) {
          return safeRedirect('state_expired');
        }
      } catch {
        return safeRedirect('state_verify');
      }
    }

    const applicationId = process.env.FAIRE_CLIENT_ID;
    const applicationSecret = process.env.FAIRE_CLIENT_SECRET;
    const redirectUrl = process.env.FAIRE_REDIRECT_URI;

    if (!applicationId || !applicationSecret || !redirectUrl) {
      console.error('[ERROR] Missing FAIRE OAuth environment variables');
      return safeRedirect('server_config');
    }

    const scope = process.env.FAIRE_OAUTH_SCOPE
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
        ];

    let tokenData;

    try {
      const tokenResponse = await fetch(
        'https://www.faire.com/api/external-api-oauth2/token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            application_token: applicationId,
            application_secret: applicationSecret,
            redirect_url: redirectUrl,
            scope,
            grant_type: 'AUTHORIZATION_CODE',
            authorization_code: authorizationCode,
          }),
        }
      );

      const raw = await tokenResponse.text();
      try {
        tokenData = JSON.parse(raw);
      } catch {
        tokenData = null;
      }

      if (!tokenResponse.ok || !tokenData?.access_token) {
        console.error('[ERROR] Faire token exchange failed');
        return safeRedirect('token_exchange_failed');
      }
    } catch (err) {
      console.error('[ERROR] Token exchange exception:', err?.message || err);
      return safeRedirect('token_exchange_error');
    }

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
        user_key: decodedState.user_display_name || null,
        UserID: decodedState.user_id || null,
      });
    } catch (err) {
      console.error('[ERROR] Failed to persist Faire token:', err?.message || err);
      return safeRedirect('persist_failed');
    }

    return safeRedirect('success');
  } catch (err) {
    console.error('[ERROR] Unexpected OAuth callback failure:', err?.message || err);
    return safeRedirect('unexpected');
  }
};
