exports.handler = async (event) => {
  const urlObj = new URL(event.rawUrl || event.headers['x-original-url'] || '', 'http://localhost');
  const code = urlObj.searchParams.get('code');
  const shop = urlObj.searchParams.get('shop');
  const state = urlObj.searchParams.get('state');
  const host = urlObj.searchParams.get('host');

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
  if (!client_id || !client_secret) {
    console.error('Missing SHOPIFY_API_KEY or SHOPIFY_API_SECRET environment variable', {
      client_id,
      client_secret
    });
    return {
      statusCode: 500,
      body: 'Missing SHOPIFY_API_KEY or SHOPIFY_API_SECRET environment variable'
    };
  }
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
    const rawResponse = await tokenResponse.text();
    try {
      tokenData = JSON.parse(rawResponse);
    } catch (jsonErr) {
      tokenData = {};
    }
    if (!tokenResponse.ok || !tokenData.access_token) {
      // Log error details for debugging
      console.error('Shopify OAuth Error:', {
        status: tokenResponse.status,
        statusText: tokenResponse.statusText,
        response: rawResponse,
        client_id,
        client_secret,
        code,
        shop
      });
      throw new Error(tokenData.error_description || rawResponse || 'Failed to get access token');
    }
    // Save shop and access token to Supabase (same table as Faire)
    try {
      const supabase = require('./supabase-client.cjs');
      // Upsert to oauth_tokens table, platform: 'shopify', user_key: shop
      await supabase.from('oauth_tokens').upsert({
        user_key: shop,
        platform: 'shopify',
        access_token: tokenData.access_token
      }, { onConflict: ['user_key', 'platform'] });
      console.log(`Saved Shopify token for shop: ${shop}`);
    } catch (err) {
      console.error('Error saving Shopify token to Supabase:', err);
    }
  } catch (err) {
    return {
      statusCode: 500,
      body: `Error exchanging code for token: ${err.message}`
    };
  }
  // Redirect to Shopify embedded app URL after authentication
  if (shop) {
    // Use the expected Shopify admin URL for embedded app (Shopify expects /apps/{app-slug})
    let redirectUrl = `https://jlfinal.netlify.app`;
    return {
      statusCode: 302,
      headers: {
        Location: redirectUrl,
        'Cache-Control': 'no-store'
      },
      body: ''
    };
  }
  // Fallback: redirect to Shopify admin apps page
  return {
    statusCode: 302,
    headers: {
      Location: 'https://admin.shopify.com/store',
      'Cache-Control': 'no-store'
    },
    body: ''
  };
};
