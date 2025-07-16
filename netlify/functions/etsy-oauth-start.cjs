// netlify/functions/etsy-oauth-start.cjs
exports.handler = async (event) => {
  const clientId = process.env.ETSY_CLIENT_ID;
  const redirectUri ="https://jlfinal.netlify.app/.netlify/functions/etsy-oauth-callback";
  // Accept 'state', 'code_challenge', and 'code_challenge_method' as query parameters from the frontend
  let state = Math.random().toString(36).substring(2);
  let code_challenge = '';
  let code_challenge_method = 'S256';
  try {
    const urlObj = new URL(event.rawUrl || event.headers['x-original-url'] || '', 'http://localhost');
    if (urlObj.searchParams.has('state')) {
      state = urlObj.searchParams.get('state');
    }
    if (urlObj.searchParams.has('code_challenge')) {
      code_challenge = urlObj.searchParams.get('code_challenge');
    }
    if (urlObj.searchParams.has('code_challenge_method')) {
      code_challenge_method = urlObj.searchParams.get('code_challenge_method');
    }
  } catch (e) {
    // Ignore URL parse errors, fallback to random state
  }
  const url = `https://www.etsy.com/oauth/connect?response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&client_id=${clientId}&scope=transactions_r&state=${state}&code_challenge=${encodeURIComponent(code_challenge)}&code_challenge_method=${encodeURIComponent(code_challenge_method)}`;
  return {
    statusCode: 302,
    headers: {
      Location: url,
    },
    body: '',
  };
};
