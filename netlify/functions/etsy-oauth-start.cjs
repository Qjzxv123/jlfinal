// Netlify Function: etsy-oauth-start
// Starts the Etsy OAuth2 flow for onboarding

const querystring = require('querystring');
const crypto = require('crypto');

exports.handler = async (event) => {
  const ETSY_CLIENT_ID = process.env.ETSY_CLIENT_ID;
  const ETSY_REDIRECT_URI = 'https://jlfinal.netlify.app/.netlify/functions/etsy-oauth-callback';
  const ETSY_SCOPES = 'transactions_r shops_r listings_r'; // adjust scopes as needed

  const stateRaw = event.queryStringParameters.state;

  if (!ETSY_CLIENT_ID || !ETSY_REDIRECT_URI) {
    return {
      statusCode: 500,
      body: 'Missing Etsy OAuth environment variables.'
    };
  }

  // PKCE: generate code_verifier and code_challenge
  function base64url(input) {
    return input.toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }
  const code_verifier = base64url(crypto.randomBytes(32));
  const code_challenge = base64url(crypto.createHash('sha256').update(code_verifier).digest());

  // Store code_verifier in state (base64-encoded JSON)
  let stateObj = {};
  try {
    stateObj = JSON.parse(Buffer.from(stateRaw, 'base64').toString('utf8'));
  } catch (e) {}
  stateObj.code_verifier = code_verifier;
  const state = Buffer.from(JSON.stringify(stateObj)).toString('base64');

  const params = querystring.stringify({
    response_type: 'code',
    client_id: ETSY_CLIENT_ID,
    redirect_uri: ETSY_REDIRECT_URI,
    scope: ETSY_SCOPES,
    state,
    code_challenge,
    code_challenge_method: 'S256'
  });

  const etsyAuthUrl = `https://www.etsy.com/oauth/connect?${params}`;

  return {
    statusCode: 302,
    headers: {
      Location: etsyAuthUrl
    },
    body: ''
  };
};
