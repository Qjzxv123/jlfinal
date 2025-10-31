exports.handler = async (event) => {
  const clientId = process.env.SHOPIFY_API_KEY;
  const redirectUri = 'https://jlfinal.netlify.app/.netlify/functions/shopify-oauth-callback';
  
  if (!clientId) {
    console.error('Missing SHOPIFY_API_KEY environment variable');
    return {
      statusCode: 500,
      body: 'Missing Shopify API credentials'
    };
  }
  
  // Get shop from query params (Shopify App Store installations will include this)
  const urlObj = new URL(event.rawUrl || event.headers['x-original-url'] || '', 'http://localhost');
  let shop = urlObj.searchParams.get('shop');
  const hmac = urlObj.searchParams.get('hmac');
  const timestamp = urlObj.searchParams.get('timestamp');
  const host = urlObj.searchParams.get('host');
  
  // For POST requests (manual shop entry), get shop from body
  if (event.httpMethod === 'POST' && !shop) {
    try {
      const body = JSON.parse(event.body);
      shop = body.domain;
      console.log('[Shopify OAuth] Manual shop entry:', shop);
    } catch (e) {
      console.error('[Shopify OAuth] Invalid JSON body:', e);
      return {
        statusCode: 400,
        body: 'Invalid JSON body',
      };
    }
  }
  
  if (!shop) {
    console.error('[Shopify OAuth] Missing shop parameter');
    return {
      statusCode: 400,
      body: 'Missing shop parameter. This typically happens when accessing the OAuth URL directly. The shop parameter should be provided by Shopify during app installation.',
    };
  }
  
  // Ensure shop domain is properly formatted (add .myshopify.com if not present)
  if (!shop.includes('.')) {
    shop = `${shop}.myshopify.com`;
  } else if (!shop.endsWith('.myshopify.com')) {
    // If it's a custom domain, we might need to convert it
    // For now, we'll assume it's already properly formatted
  }
  
  console.log('[Shopify OAuth] Starting OAuth for shop:', shop);
  
  // Generate a secure state parameter that includes shop info for validation
  const stateData = {
    shop: shop,
    timestamp: Date.now(),
    nonce: Math.random().toString(36).substring(2),
    ...(host && { host }) // Include host if present for embedded apps
  };
  const state = Buffer.from(JSON.stringify(stateData)).toString('base64');
  
  // Build OAuth URL following Shopify's official OAuth flow
  const oauthUrl = `https://${shop}/admin/oauth/authorize?` + new URLSearchParams({
    client_id: clientId,
    scope: 'read_products,read_orders,write_orders', // Add write_orders for order management
    redirect_uri: redirectUri,
    state: state,
    response_type: 'code'
  }).toString();
  
  console.log('[Shopify OAuth] Redirecting to OAuth URL for shop:', shop);
  
  return {
    statusCode: 302,
    headers: {
      Location: oauthUrl,
      'Cache-Control': 'no-store'
    },
    body: '',
  };
};
