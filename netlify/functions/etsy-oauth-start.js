// netlify/functions/etsy-oauth-start.js
exports.handler = async (event) => {
  // TODO: Replace with your Etsy OAuth client ID and redirect URI
  const clientId = process.env.ETSY_CLIENT_ID;
  const redirectUri = process.env.ETSY_REDIRECT_URI;
  const state = Math.random().toString(36).substring(2);
  const url = `https://www.etsy.com/oauth/connect?response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&client_id=${clientId}&scope=transactions_r&state=${state}`;
  return {
    statusCode: 302,
    headers: {
      Location: url,
    },
  };
};
