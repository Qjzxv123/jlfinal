// netlify/functions/faire-oauth-start.cjs
exports.handler = async (event) => {
  const clientId = process.env.FAIRE_CLIENT_ID;
  const redirectUri = process.env.FAIRE_REDIRECT_URI;
  const state = Math.random().toString(36).substring(2);
  const url = `https://www.faire.com/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${state}`;
  console.log('[DEBUG] FAIRE_CLIENT_ID:', clientId);
  console.log('[DEBUG] FAIRE_REDIRECT_URI:', redirectUri);
  console.log('[DEBUG] Redirecting to:', url);
  return {
    statusCode: 302,
    headers: {
      Location: url,
    },
    body: '',
  };
};
