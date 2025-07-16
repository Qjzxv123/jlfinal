// netlify/functions/faire-oauth-callback.cjs
exports.handler = async (event) => {


  const urlObj = new URL(event.rawUrl || event.headers['x-original-url'] || '', 'http://localhost');
  // Accept both 'code' and 'authorization_code' as valid
  let authorizationCode = urlObj.searchParams.get('code') || urlObj.searchParams.get('authorization_code');
  const state = urlObj.searchParams.get('state');
  console.log('[DEBUG] Callback received:', { authorizationCode, state });

  if (!authorizationCode) {
    console.log('[DEBUG] Missing code/authorization_code parameter');
    return {
      statusCode: 400,
      body: 'Missing code parameter',
    };
  }

  // Exchange code for access token with Faire v2 OAuth endpoint
  const applicationId = process.env.FAIRE_CLIENT_ID;
  const applicationSecret = process.env.FAIRE_CLIENT_SECRET;
  const redirectUrl = process.env.FAIRE_REDIRECT_URI;
  // Faire expects scope as an array of strings in the POST body
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
      'READ_SHIPMENTS'
    ];
  let tokenResponse, tokenData;
  try {
    if (authorizationCode === 'testcode') {
      // Mock response for local testing
      tokenData = {
        access_token: 'mock_access_token',
        refresh_token: 'mock_refresh_token',
        expires_in: 3600,
        token_type: 'BEARER',
        mock: true
      };
      tokenResponse = { ok: true };
      console.log('[DEBUG] Mock token response:', tokenData);
    } else {
      tokenResponse = await fetch('https://www.faire.com/api/external-api-oauth2/token', {
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
      });
      tokenData = await tokenResponse.json();
      console.log('[DEBUG] Token response:', tokenData);
      if (!tokenResponse.ok || !tokenData.access_token) {
        // Log the full response for debugging
        console.error('[ERROR] Full token response:', tokenData);
        return {
          statusCode: 500,
          body: 'Error exchanging code for token: ' + (tokenData.error_description || tokenData.error || 'No access_token in response') + '\nFull response: ' + JSON.stringify(tokenData),
        };
      }
    }
  } catch (err) {
    console.log('[DEBUG] Error exchanging code for token:', err);
    return {
      statusCode: 500,
      body: 'Error exchanging code for token: ' + err.message,
    };
  }



  // Save token to Supabase
  try {
      const { saveTokenRow } = require('./faire-token-utils.cjs');
      // Calculate expires_at if present
      let expires_at = null;
      if (tokenData.expires_in) {
        expires_at = Date.now() + (tokenData.expires_in * 1000);
      }
      const cookie = event.headers.cookie || '';
      const supabaseSession = cookie.split(';').find(c => c.trim().startsWith('sb-access-token='));
      if (supabaseSession) {
        const jwt = supabaseSession.split('=')[1];
        // Decode JWT to extract email
        const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString('utf8'));
        user_email = payload.email || null;
      }
      await saveTokenRow(state, {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || null,
        expires_at,
        token_type: tokenData.token_type || tokenData.tokenType || null,
        user_key: user_email // This will be the email if extracted, or null
      });
  } catch (e) {
    console.log('[DEBUG] Error saving token to Supabase:', e);
  }

  // Redirect user back to the main app after successful connection
  const redirectAfterOAuth = '/public/ecommerce-oauth.html';
  return {
    statusCode: 302,
    headers: {
      Location: redirectAfterOAuth,
      'Cache-Control': 'no-store',
    },
    body: '',
  };
};
