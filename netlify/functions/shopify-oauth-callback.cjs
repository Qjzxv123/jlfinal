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

  // Redirect to Shopify embedded app URL after authentication
  if (host && shop) {
    // Extract store name from shop domain
    const storeName = shop.replace('.myshopify.com', '');
    return {
      statusCode: 302,
      headers: {
        Location: `https://admin.shopify.com/store/${storeName}/app/grant?host=${encodeURIComponent(host)}`,
        'Cache-Control': 'no-store'
      },
      body: ''
    };
  }
  // Fallback: redirect to app home
  return {
    statusCode: 302,
    headers: {
      Location: '/ecommerce-oauth.html',
      'Cache-Control': 'no-store'
    },
    body: ''
  };
};
