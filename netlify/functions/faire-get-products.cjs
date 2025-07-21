const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

exports.handler = async function(event, context) {
  // Support GET to fetch Faire products
  // Allow Netlify CLI local invoke (POST with no body) to act as GET
  const isNetlifyInvoke = event.httpMethod === 'POST' && (!event.body || event.body === '' || event.body === '{}');
  if (event.httpMethod === 'GET' || isNetlifyInvoke) {
    const { createClient } = require('@supabase/supabase-js');
    const credentials = Buffer.from(`${process.env.FAIRE_CLIENT_ID}:${process.env.FAIRE_CLIENT_SECRET}`).toString('base64');
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Find the oauth token for Desesh (user_key = 'Desesh', provider = 'faire')
    const { data: tokenRow, error: tokenError } = await supabase
      .from('oauth_tokens')
      .select('access_token')
      .eq('user_key', 'Desesh')
      .eq('platform', 'faire')
      .maybeSingle();
    if (tokenError || !tokenRow || !tokenRow.access_token) {
      return { statusCode: 500, body: 'Missing Faire Desesh access token in oauth_tokens' };
    }
    const apiToken = tokenRow.access_token;

    // Faire GET products endpoint
    const url = 'https://www.faire.com/external-api/v2/products';
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'X-FAIRE-APP-CREDENTIALS': credentials,
        'X-FAIRE-OAUTH-ACCESS-TOKEN': apiToken,
        'Content-Type': 'application/json'
      }
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to fetch products', details: data }) };
    }
    // Log summary for debugging
    const productCount = Array.isArray(data.products) ? data.products.length : 0;
    console.log('[faire-get-products] Success:', { productCount });
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `Fetched ${productCount} products from Faire`,
        product_count: productCount,
        data
      })
    };
  } else if (event.httpMethod === 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed. Use GET.' };
  }
  // fallback for other methods/paths
  return { statusCode: 404, body: 'Not found' };
}
