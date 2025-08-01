// netlify/functions/faire-oauth-callback.cjs
exports.handler = async (event) => {


  const urlObj = new URL(event.rawUrl || event.headers['x-original-url'] || '', 'http://localhost');
  // Accept both 'code' and 'authorization_code' as valid
  let authorizationCode = urlObj.searchParams.get('code') || urlObj.searchParams.get('authorization_code');
  let state = urlObj.searchParams.get('state');
  let decodedState = {};
  if (state) {
    try {
      decodedState = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
    } catch (e) {
      console.log('[DEBUG] Failed to decode state:', e);
    }
  }
  const user_id = decodedState.user_id || null;
  const display_name = decodedState.user_display_name || null;
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
      'READ_SHIPMENTS',
      'WRITE_SHIPMENTS'
    ];
  let tokenResponse, tokenData;
  try {
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
      // Only use email/id from state for user_key and UserID
      await saveTokenRow(state, {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || null,
        expires_at,
        user_key: display_name || null, // Save email as user_key
        UserID: user_id || null      // Save id as UserID
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
