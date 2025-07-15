// netlify/functions/shopify-oauth-callback.js
export default async (request) => {
  const urlObj = new URL(request.url);
  const code = urlObj.searchParams.get('code');
  const shop = urlObj.searchParams.get('shop');
  const state = urlObj.searchParams.get('state');

  if (!code || !shop) {
    return new Response('Missing code or shop parameter', { status: 400 });
  }

  // Here you would exchange the code for an access token with Shopify
  // For now, just display the received parameters for testing
  const html = `
    <h1>Shopify OAuth Callback</h1>
    <p>Shop: ${shop}</p>
    <p>Code: ${code}</p>
    <p>State: ${state}</p>
    <p>Implement token exchange and user onboarding here.</p>
  `;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  });
};
