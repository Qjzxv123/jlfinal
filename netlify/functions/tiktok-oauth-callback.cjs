// Netlify Function: tiktokshop-oauth-callback
// Handles the OAuth2 callback from TikTok Shop, exchanges code for access token, and stores in Supabase
// Use native fetch (Node 18+ on Netlify)
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TIKTOK_APP_KEY = process.env.TIKTOK_APP_KEY;
const TIKTOK_APP_SECRET = process.env.TIKTOK_APP_SECRET;
// Hardcoded TikTok Shop redirect URI (update as needed)
const TIKTOK_REDIRECT_URI = 'https://jlfinal.netlify.app/.netlify/functions/tiktok-oauth-callback';

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

  // Parse state for user info
  let userInfo = {};
  try {
    const stateObj = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
    userInfo = stateObj;
  } catch (e) {}

  // Exchange code for access token
  const tokenRes = await fetch('https://auth.tiktok-shops.com/api/v2/token/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      code,
      grant_type: 'authorized_code',
      client_key: TIKTOK_APP_KEY,
      client_secret: TIKTOK_APP_SECRET,
      redirect_uri: TIKTOK_REDIRECT_URI
    })
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    return {
      statusCode: 500,
      body: 'Failed to get TikTok Shop token: ' + err
    };
  }

  const tokenData = await tokenRes.json();
  // tokenData: { access_token, refresh_token, expires_in, ... }

  // Store in Supabase oauth_tokens table
  if (userInfo.user_id) {
    const { data, error } = await supabase.from('oauth_tokens').upsert({
      UserID: userInfo.user_id,
      platform: 'tiktokshop',
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (tokenData.expires_in || 0),
      user_key: userInfo.user_display_name || null
    });
    console.log('[TIKTOK SHOP OAUTH CALLBACK] Upsert result:', { data, error });
  }

  // Redirect to onboarding complete page
  return {
    statusCode: 302,
    headers: {
      Location: '/ecommerce-oauth.html?tiktokshop=success'
    },
    body: ''
  };
};
