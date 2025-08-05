exports.handler = async (event) => {
  const urlObj = new URL(event.rawUrl || event.headers['x-original-url'] || '', 'http://localhost');
  const code = urlObj.searchParams.get('code');
  const shop = urlObj.searchParams.get('shop');
  const host = urlObj.searchParams.get('host');

  if (!code || !shop) {
    return {
      statusCode: 400,
      body: 'Missing code or shop parameter',
    };
  }

  // Exchange the code for an access token with Shopify
  const client_id = process.env.SHOPIFY_API_KEY;
  const client_secret = process.env.SHOPIFY_API_SECRET;
  
  if (!client_id || !client_secret) {
    console.error('Missing SHOPIFY_API_KEY or SHOPIFY_API_SECRET environment variable');
    return {
      statusCode: 500,
      body: 'Missing Shopify API credentials'
    };
  }

  let tokenData;
  try {
    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id,
        client_secret,
        code
      })
    });
    
    const rawResponse = await tokenResponse.text();
    tokenData = JSON.parse(rawResponse);
    
    if (!tokenResponse.ok || !tokenData.access_token) {
      console.error('Shopify OAuth Error:', {
        status: tokenResponse.status,
        response: rawResponse
      });
      throw new Error(tokenData.error_description || 'Failed to get access token');
    }

    // Store token temporarily in a secure way (using state parameter or session storage)
    // For now, we'll redirect to login with the token info encoded securely
    console.log(`Shopify OAuth successful for shop: ${shop}, redirecting to login`);

  } catch (err) {
    console.error('Error in Shopify OAuth:', err);
    return {
      statusCode: 500,
      body: `Error exchanging code for token: ${err.message}`
    };
  }

  // Redirect to login page with encoded token data that will be saved after user authenticates
  const baseUrl = 'https://jlfinal.netlify.app';
  const tokenInfo = {
    shop: shop,
    access_token: tokenData.access_token,
    platform: 'shopify',
    timestamp: Date.now()
  };
  
  // Base64 encode the token info to pass it securely
  const encodedTokenInfo = Buffer.from(JSON.stringify(tokenInfo)).toString('base64');
  const hostParam = host ? `&host=${encodeURIComponent(host)}` : '';
  const redirectUrl = `${baseUrl}/Login.html?shopify_token=${encodeURIComponent(encodedTokenInfo)}&returnTo=${encodeURIComponent('/ecommerce-oauth.html?shopify_oauth_complete=true')}${hostParam}`;
  
  console.log(`Redirecting to login with token info for shop: ${shop}`);
  return {
    statusCode: 302,
    headers: {
      Location: redirectUrl,
      'Cache-Control': 'no-store'
    },
    body: ''
  };
};
