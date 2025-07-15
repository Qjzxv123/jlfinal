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

  // Here you would exchange the code for an access token with Shopify
  // For now, just display the received parameters for testing
  const html = `
    <h1>Shopify OAuth Callback</h1>
    <p>Shop: ${shop}</p>
    <p>Code: ${code}</p>
    <p>State: ${state}</p>
    <p>Implement token exchange and user onboarding here.</p>
  `;
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html' },
    body: html,
  };
};
