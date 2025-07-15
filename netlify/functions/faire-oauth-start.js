// netlify/functions/faire-oauth-start.js
exports.handler = async (event) => {
  // TODO: Replace with your Faire OAuth client ID and redirect URI
  const clientId = process.env.FAIRE_CLIENT_ID;
  const redirectUri = process.env.FAIRE_REDIRECT_URI;
  const state = Math.random().toString(36).substring(2);
  const url = `https://www.faire.com/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${state}`;
  return {
    statusCode: 302,
    headers: {
      Location: url,
    },
  };
};
