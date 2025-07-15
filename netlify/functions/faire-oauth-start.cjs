// netlify/functions/faire-oauth-start.cjs
exports.handler = async (event) => {
  const clientId = process.env.FAIRE_CLIENT_ID;
  const redirectUri = process.env.FAIRE_REDIRECT_URI;
  const state = Math.random().toString(36).substring(2);
  const scopes = [
    'READ_ORDERS',
    'WRITE_ORDERS',
    'READ_PRODUCTS',
    'WRITE_PRODUCTS',
    'READ_INVENTORIES',
    'WRITE_INVENTORIES',
    'READ_BRAND',
    'READ_RETAILER',
    'READ_SHIPMENTS'
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
