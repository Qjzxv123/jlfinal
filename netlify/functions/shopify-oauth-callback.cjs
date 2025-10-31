exports.handler = async (event) => {
  const urlObj = new URL(event.rawUrl || event.headers['x-original-url'] || '', 'http://localhost');
  const code = urlObj.searchParams.get('code');
  const shop = urlObj.searchParams.get('shop');
  const state = urlObj.searchParams.get('state');
  const host = urlObj.searchParams.get('host');

  console.log('[Shopify OAuth Callback] Received parameters:', { 
    code: code ? 'present' : 'missing', 
    shop: shop || 'missing', 
    state: state ? 'present' : 'missing',
    host: host || 'none'
  });

  if (!code || !shop) {
    console.error('[Shopify OAuth Callback] Missing required parameters');
    return {
      statusCode: 400,
      body: 'Missing code or shop parameter. This indicates an incomplete OAuth flow.',
    };
  }

  // Validate state parameter for security
  let stateData = null;
  if (state) {
    try {
      stateData = JSON.parse(Buffer.from(state, 'base64').toString());
      // Verify shop matches the state
      if (stateData.shop !== shop) {
        console.error('[Shopify OAuth Callback] Shop mismatch in state validation');
        return {
          statusCode: 400,
          body: 'Invalid state parameter - shop mismatch',
        };
      }
      // Check timestamp to prevent replay attacks (max 10 minutes old)
      if (Date.now() - stateData.timestamp > 10 * 60 * 1000) {
        console.error('[Shopify OAuth Callback] State parameter too old');
        return {
          statusCode: 400,
          body: 'OAuth request expired, please try again',
        };
      }
    } catch (e) {
      console.error('[Shopify OAuth Callback] Invalid state parameter:', e);
      return {
        statusCode: 400,
        body: 'Invalid state parameter',
      };
    }
  }

  // Exchange the code for an access token with Shopify
  const client_id = process.env.SHOPIFY_API_KEY;
  const client_secret = process.env.SHOPIFY_API_SECRET;
  
  if (!client_id || !client_secret) {
    console.error('[Shopify OAuth Callback] Missing SHOPIFY_API_KEY or SHOPIFY_API_SECRET environment variable');
    return {
      statusCode: 500,
      body: 'Missing Shopify API credentials'
    };
  }

  let tokenData;
  try {
    console.log('[Shopify OAuth Callback] Exchanging code for access token with shop:', shop);
    
    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        client_id,
        client_secret,
        code
      })
    });
    
    const rawResponse = await tokenResponse.text();
    
    if (!tokenResponse.ok) {
      console.error('[Shopify OAuth Callback] Token exchange failed:', {
        status: tokenResponse.status,
        statusText: tokenResponse.statusText,
        response: rawResponse
      });
      throw new Error(`HTTP ${tokenResponse.status}: ${tokenResponse.statusText}`);
    }
    
    tokenData = JSON.parse(rawResponse);
    
    if (!tokenData.access_token) {
      console.error('[Shopify OAuth Callback] No access token in response:', rawResponse);
      throw new Error('No access token received from Shopify');
    }

    console.log('[Shopify OAuth Callback] Successfully obtained access token for shop:', shop);

  } catch (err) {
    console.error('[Shopify OAuth Callback] Error exchanging code for token:', err);
    return {
      statusCode: 500,
      body: `Error exchanging authorization code for access token: ${err.message}`
    };
  }

  // Prepare token info for secure transfer to the frontend
  const tokenInfo = {
    shop: shop,
    access_token: tokenData.access_token,
    platform: 'shopify',
    scope: tokenData.scope || 'read_products,read_orders,write_orders',
    timestamp: Date.now(),
    // Include host for embedded apps
    ...(host && { host })
  };
  
  // Base64 encode the token info to pass it securely to the login page
  const encodedTokenInfo = Buffer.from(JSON.stringify(tokenInfo)).toString('base64');
  
  // Build redirect URL - this will take user to login page where they can authenticate
  // and the token will be saved to the database after user login
  const baseUrl = 'https://jlfinal.netlify.app';
  const hostParam = host ? `&host=${encodeURIComponent(host)}` : '';
  const returnPath = `/ecommerce-oauth.html?shopify_oauth_complete=true&shop=${encodeURIComponent(shop)}`;
  const redirectUrl = `${baseUrl}/Login.html?shopify_token=${encodeURIComponent(encodedTokenInfo)}&returnTo=${encodeURIComponent(returnPath)}${hostParam}`;
  
  console.log('[Shopify OAuth Callback] Redirecting to login page for final authentication');
  
  return {
    statusCode: 302,
    headers: {
      Location: redirectUrl,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache'
    },
    body: ''
  };
};
