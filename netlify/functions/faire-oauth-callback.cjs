// netlify/functions/faire-oauth-callback.cjs
exports.handler = async (event) => {

  const urlObj = new URL(event.rawUrl || event.headers['x-original-url'] || '', 'http://localhost');
  const code = urlObj.searchParams.get('code');
  const state = urlObj.searchParams.get('state');
  console.log('[DEBUG] Callback received:', { code, state });

  if (!code) {
    console.log('[DEBUG] Missing code parameter');
    return {
      statusCode: 400,
      body: 'Missing code parameter',
    };
  }

  // Exchange code for access token with Faire
  const clientId = process.env.FAIRE_CLIENT_ID;
  const clientSecret = process.env.FAIRE_CLIENT_SECRET;
  const redirectUri = process.env.FAIRE_REDIRECT_URI;
  console.log('[DEBUG] Using clientId:', clientId);
  console.log('[DEBUG] Using redirectUri:', redirectUri);
  let tokenResponse, tokenData;
  try {
    tokenResponse = await fetch('https://www.faire.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    tokenData = await tokenResponse.json();
    console.log('[DEBUG] Token response:', tokenData);
  } catch (err) {
    console.log('[DEBUG] Error exchanging code for token:', err);
    return {
      statusCode: 500,
      body: 'Error exchanging code for token: ' + err.message,
    };
  }

  // Save token to a JSON file (for testing/demo purposes only)
  const fs = require('fs');
  const path = require('path');
  const savePath = path.join(__dirname, 'faire-tokens.json');
  let tokens = [];
  try {
    if (fs.existsSync(savePath)) {
      tokens = JSON.parse(fs.readFileSync(savePath, 'utf8'));
    }
  } catch (e) {}
  tokens.push({ code, state, tokenData, created: new Date().toISOString() });
  try {
    fs.writeFileSync(savePath, JSON.stringify(tokens, null, 2));
  } catch (e) {}

  const html = `
    <h1>Faire OAuth Callback</h1>
    <p>Code: ${code}</p>
    <p>State: ${state}</p>
    <pre>${JSON.stringify(tokenData, null, 2)}</pre>
    <p>Token saved to faire-tokens.json (server-side only).</p>
  `;
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html' },
    body: html,
  };
};
