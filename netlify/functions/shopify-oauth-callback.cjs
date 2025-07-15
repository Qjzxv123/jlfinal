exports.handler = async (event) => {
  const urlObj = new URL(event.rawUrl || event.headers['x-original-url'] || '', 'http://localhost');
  const code = urlObj.searchParams.get('code');
  const shop = urlObj.searchParams.get('shop');
  const state = urlObj.searchParams.get('state');

  if (!code || !shop) {
    return {
      statusCode: 400,
      body: 'Missing code or shop parameter',
    };
  }

  // Exchange the code for an access token with Shopify
  const fetch = global.fetch || require('node-fetch');
  const client_id = process.env.SHOPIFY_API_KEY;
  const client_secret = process.env.SHOPIFY_API_SECRET;
  let tokenResponse, tokenData;
  try {
    tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id,
        client_secret,
        code
      })
    });
    tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) {
      throw new Error(tokenData.error_description || 'Failed to get access token');
    }
  } catch (err) {
    return {
      statusCode: 500,
      body: `Error exchanging code for token: ${err.message}`
    };
  }

  // Save shop and access token to Supabase (optional, implement as needed)
  // const supabase = require('./supabase-client.cjs');
  // await supabase.from('shopify_tokens').upsert({ shop, access_token: tokenData.access_token });

  // Success HTML
  const html = `
    <h1>Shopify OAuth Success</h1>
    <p>Shop: ${shop}</p>
    <p>Access Token: ${tokenData.access_token}</p>
    <p>Scope: ${tokenData.scope}</p>
    <p>Associated User: ${tokenData.associated_user ? JSON.stringify(tokenData.associated_user) : 'N/A'}</p>
    <p>App installed! You can now close this window.</p>
  `;
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html' },
    body: html,
  };
};
