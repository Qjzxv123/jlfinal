// Netlify Function: etsy-oauth-callback
// Handles the OAuth2 callback from Etsy, exchanges code for access token, and stores in Supabase
// Use native fetch (Node 18+ on Netlify)
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ETSY_CLIENT_ID = process.env.ETSY_CLIENT_ID;
const ETSY_CLIENT_SECRET = process.env.ETSY_CLIENT_SECRET;
// Hardcoded Etsy redirect URI (update as needed)
const ETSY_REDIRECT_URI = 'https://jlfinal.netlify.app/.netlify/functions/etsy-oauth-callback';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

exports.handler = async (event) => {
  const code = event.queryStringParameters.code;
  const state = event.queryStringParameters.state;

  if (!code || !state) {
    return {
      statusCode: 400,
      body: 'Missing code or state.'
    };
  }


  // Parse state for user info and PKCE code_verifier
  let userInfo = {};
  let code_verifier = undefined;
  try {
    const stateObj = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
    userInfo = stateObj;
    code_verifier = stateObj.code_verifier;
  } catch (e) {}

  // Exchange code for access token (with PKCE)
  const tokenRes = await fetch('https://api.etsy.com/v3/public/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: ETSY_CLIENT_ID,
      client_secret: ETSY_CLIENT_SECRET,
      redirect_uri: ETSY_REDIRECT_URI,
      code,
      ...(code_verifier ? { code_verifier } : {})
    })
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    return {
      statusCode: 500,
      body: 'Failed to get Etsy token: ' + err
    };
  }

  const tokenData = await tokenRes.json();
  // tokenData: { access_token, refresh_token, expires_in, ... }

  // userInfo already parsed above

  // Store in Supabase oauth_tokens table
  if (userInfo.user_id) {
    const { data, error } = await supabase.from('oauth_tokens').upsert({
      user_id: userInfo.user_id,
      platform: 'etsy',
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (tokenData.expires_in || 0),
      user_display_name: userInfo.user_display_name || null
    }, { onConflict: ['user_id', 'platform'] });
    console.log('[ETSY OAUTH CALLBACK] Upsert result:', { data, error });
  }

  // Redirect to onboarding complete page
  return {
    statusCode: 302,
    headers: {
      Location: '/ecommerce-oauth.html?etsy=success'
    },
    body: ''
  };
};
