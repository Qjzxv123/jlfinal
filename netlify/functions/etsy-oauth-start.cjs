// netlify/functions/etsy-oauth-start.cjs
exports.handler = async (event) => {
  const clientId = process.env.ETSY_CLIENT_ID;
  const redirectUri = process.env.ETSY_REDIRECT_URI;
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
  const url = `https://www.etsy.com/oauth/connect?response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&client_id=${clientId}&scope=transactions_r&state=${state}`;
  return {
    statusCode: 302,
    headers: {
      Location: url,
    },
    body: '',
  };
};
