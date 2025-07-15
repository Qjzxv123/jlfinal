// netlify/functions/shopify-oauth-start.js
exports.handler = async (event) => {
  // TODO: Replace with your Shopify API key and redirect URI
  const clientId = process.env.SHOPIFY_API_KEY;
  const redirectUri = process.env.SHOPIFY_REDIRECT_URI;
  const shop = event.queryStringParameters && event.queryStringParameters.shop;
  if (!shop) {
    return {
      statusCode: 400,
      body: 'Missing shop parameter',
    };
  }
  const state = Math.random().toString(36).substring(2);
  const url = `https://${shop}/admin/oauth/authorize?client_id=${clientId}&scope=read_products,read_orders&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&response_type=code`;
  return {
    statusCode: 302,
    headers: {
      Location: url,
    },
  };
};
