// netlify/functions/shopify-oauth-start.cjs
exports.handler = async (event) => {
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  let shop;
  const redirectUri = 'https://jlfinal.netlify.app/.netlify/functions/shopify-oauth-callback';
  if (event.httpMethod === 'POST') {
    try {
      const body = JSON.parse(event.body);
      shop = body.domain;
      console.log('[DEBUG] POST body.domain:', shop);
    } catch (e) {
      console.log('[DEBUG] Invalid JSON body:', e);
      return {
        statusCode: 400,
        body: 'Invalid JSON body',
      };
    }
  } else {
    const urlObj = new URL(event.rawUrl || event.headers['x-original-url'] || '', 'http://localhost');
    shop = urlObj.searchParams.get('shop');
    console.log('[DEBUG] GET shop param:', shop);
  }
  if (!shop) {
    console.log('[DEBUG] Missing shop parameter');
    return {
      statusCode: 400,
      body: 'Missing shop parameter',
    };
  }
  const state = Math.random().toString(36).substring(2);
  const redirect = `https://${shop}/admin/oauth/authorize?client_id=${clientId}&scope=read_products,read_orders&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&response_type=code`;
  console.log('[DEBUG] Redirecting to:', redirect);
  return {
    statusCode: 302,
    headers: {
      Location: redirect,
    },
    body: '',
  };
};
