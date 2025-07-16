// netlify/functions/etsy-oauth-callback.cjs
exports.handler = async (event) => {
  const urlObj = new URL(event.rawUrl || event.headers['x-original-url'] || '', 'http://localhost');
  const code = urlObj.searchParams.get('code');
  let state = urlObj.searchParams.get('state');
  let decodedState = {};
  if (state) {
    try {
      decodedState = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
    } catch (e) {
      console.log('[DEBUG][Etsy] Failed to decode state:', e);
    }
  }
  const user_id = decodedState.user_id || null;
  const user_email = decodedState.user_email || null;
  // PKCE: Require code_verifier in state for Etsy OAuth
  let code_verifier = decodedState.code_verifier || '';

  // Debug log incoming URL and state for troubleshooting
  console.log('[DEBUG][Etsy] Callback URL:', event.rawUrl || event.headers['x-original-url']);
  console.log('[DEBUG][Etsy] code:', code);
  console.log('[DEBUG][Etsy] state:', state);
  console.log('[DEBUG][Etsy] decodedState:', decodedState);
  console.log('[DEBUG][Etsy] code_verifier:', code_verifier);

  if (!code) {
    return {
      statusCode: 400,
      body: 'Missing code parameter. Debug info: ' + JSON.stringify({ rawUrl: event.rawUrl, state, decodedState }),
    };
  }
  if (!code_verifier) {
    return {
      statusCode: 400,
      body: 'Missing code_verifier for PKCE. Debug info: ' + JSON.stringify({ rawUrl: event.rawUrl, state, decodedState }),
    };
  }

  // Exchange code for access token
  let tokenData;
  try {
    const tokenResp = await fetch('https://api.etsy.com/v3/public/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.ETSY_CLIENT_ID,
        client_secret: process.env.ETSY_CLIENT_SECRET,
        code,
        redirect_uri: "https://jlfinal.netlify.app/.netlify/functions/etsy-oauth-callback",
        code_verifier
      }).toString()
    });
    tokenData = await tokenResp.json();
    if (!tokenResp.ok || !tokenData.access_token) {
      return {
        statusCode: 500,
        body: 'Error exchanging code for token: ' + (tokenData.error_description || tokenData.error || 'No access_token in response') + '\nFull response: ' + JSON.stringify(tokenData),
      };
    }
  } catch (err) {
    return {
      statusCode: 500,
      body: 'Error exchanging code for token: ' + err.message,
    };
  }

  // Save token to Supabase
  try {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    await supabase.from('oauth_tokens').upsert({
      user_key: user_email,
      UserID: user_id,
      platform: 'etsy',
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || null,
      expires_at: tokenData.expires_in ? Date.now() + (tokenData.expires_in * 1000) : null,
      token_type: tokenData.token_type || null
    }, { onConflict: ['user_key', 'platform'] });
  } catch (e) {
    console.log('[DEBUG][Etsy] Error saving token to Supabase:', e);
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
