// netlify/functions/shopify-oauth-start.js
exports.handler = async (event) => {
  const clientId = process.env.SHOPIFY_API_KEY;
  const redirectUri = process.env.SHOPIFY_REDIRECT_URI;
  let shop;
  if (event.httpMethod === 'POST') {
    try {
      const body = JSON.parse(event.body);
      shop = body.domain;
    } catch (e) {
      return {
        statusCode: 400,
        body: 'Invalid JSON body',
      };
    }
  } else {
    const urlObj = new URL(event.rawUrl || event.headers['x-original-url'] || '', 'http://localhost');
    shop = urlObj.searchParams.get('shop');
  }
  if (!shop) {
    return {
      statusCode: 400,
      body: 'Missing shop parameter',
    };
  }
  const state = Math.random().toString(36).substring(2);
  const redirect = `https://${shop}/admin/oauth/authorize?client_id=${clientId}&scope=read_products,read_orders&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&response_type=code`;
  return {
    statusCode: 302,
    headers: {
      Location: redirect,
    },
    body: '',
  };
};
