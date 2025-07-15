// netlify/functions/shopify-oauth-start.js
export default async (request) => {
  const clientId = process.env.SHOPIFY_API_KEY;
  const redirectUri = process.env.SHOPIFY_REDIRECT_URI;
  // Use URL API to parse query parameters from request.url
  const urlObj = new URL(request.url);
  const shop = urlObj.searchParams.get('shop');
  console.log('request.url:', request.url);
  console.log('shop:', shop);
  if (!shop) {
    return new Response('Missing shop parameter', { status: 400 });
  }
  const state = Math.random().toString(36).substring(2);
  const redirect = `https://${shop}/admin/oauth/authorize?client_id=${clientId}&scope=read_products,read_orders&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&response_type=code`;
  return Response.redirect(redirect, 302);
};
