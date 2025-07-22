// netlify/functions/faire-oauth-start.cjs
exports.handler = async (event) => {
  const clientId = process.env.FAIRE_CLIENT_ID;
  const redirectUri = process.env.FAIRE_REDIRECT_URI;
  // Accept 'state' as a query parameter from the frontend, fallback to random string
  let state = Math.random().toString(36).substring(2);
  try {
    const urlObj = new URL(event.rawUrl || event.headers['x-original-url'] || '', 'http://localhost');
    if (urlObj.searchParams.has('state')) {
      state = urlObj.searchParams.get('state');
    }
  } catch (e) {
    // Ignore URL parse errors, fallback to random state
  }
  const scopes = [
    'READ_ORDERS',
    'WRITE_ORDERS',
    'READ_PRODUCTS',
    'WRITE_PRODUCTS',
    'READ_INVENTORIES',
    'WRITE_INVENTORIES',
    'READ_BRAND',
    'READ_RETAILER',
    'READ_SHIPMENTS',
    'WRITE_SHIPMENTS'
  ];
  const scopeParams = scopes.map(scope => `scope=${scope}`).join('&');
  const authUrl = `https://faire.com/oauth2/authorize?applicationId=${clientId}&${scopeParams}&state=${state}&redirectUrl=${encodeURIComponent(redirectUri)}`;
  console.log('[DEBUG] FAIRE_CLIENT_ID:', clientId);
  console.log('[DEBUG] FAIRE_REDIRECT_URI:', redirectUri);
  console.log('[DEBUG] Redirecting to:', authUrl);
  return {
    statusCode: 302,
    headers: {
      Location: authUrl,
    },
    body: '',
  };
};
