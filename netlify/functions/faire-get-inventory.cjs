const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

exports.handler = async function(event, context) {
  // Support GET /get-inventory to fetch Faire inventory for all JNL SKUs
  // Accept GET to this function regardless of path, as Netlify invokes the function directly
  // Allow Netlify CLI local invoke (POST with no body) to act as GET
  const isNetlifyInvoke = event.httpMethod === 'POST' && (!event.body || event.body === '' || event.body === '{}');
  if (event.httpMethod === 'GET' || isNetlifyInvoke) {
    const { createClient } = require('@supabase/supabase-js');
    const credentials = Buffer.from(`${process.env.FAIRE_CLIENT_ID}:${process.env.FAIRE_CLIENT_SECRET}`).toString('base64');
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Find the oauth token for JNL (user_key = 'JNL', provider = 'faire')
    const { data: tokenRow, error: tokenError } = await supabase
      .from('oauth_tokens')
      .select('access_token')
      .eq('user_key', 'River')
      .eq('platform', 'faire')
      .maybeSingle();
    if (tokenError || !tokenRow || !tokenRow.access_token) {
      return { statusCode: 500, body: 'Missing Faire River access token in oauth_tokens' };
    }
    const apiToken = tokenRow.access_token;

    // Fetch all SKUs for JNL
    const { data: products, error: productsError } = await supabase
      .from('Products')
      .select('ProductSKU')
      .eq('Retailer', 'River'); ;
    if (productsError || !products) {
      return { statusCode: 500, body: 'Failed to fetch products from Supabase' };
    }
    const skus = products
      .map(p => p.ProductSKU && typeof p.ProductSKU === 'string' ? p.ProductSKU.trim().toUpperCase() : null)
      .filter(Boolean);
    if (skus.length === 0) {
      return { statusCode: 400, body: 'No SKUs found in Products table' };
    }

    // Faire GET endpoint expects multiple skus=... query params, not a comma-separated list
    const skuParams = skus.map(sku => `skus=${encodeURIComponent(sku)}`).join('&');
    const url = `https://www.faire.com/external-api/v2/product-inventory/by-skus?${skuParams}`;
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
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to fetch inventory', details: data }) };
    }
    // Log more info for successful response
    const inventoryCount = Array.isArray(data.inventories) ? data.inventories.length : 0;
    const logInfo = {
      requested_skus: skus,
      returned_inventory_count: inventoryCount,
      returned_inventory_skus: Array.isArray(data.inventories) ? data.inventories.map(inv => inv.sku) : [],
    };
    console.log('[faire-get-inventory] Success:', JSON.stringify(logInfo));
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `Fetched inventory for ${skus.length} SKUs`,
        requested_skus: skus,
        returned_inventory_count: inventoryCount,
        returned_inventory_skus: logInfo.returned_inventory_skus,
        data
      })
    };
  } else if (event.httpMethod === 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed. Use GET.' };
  }
  // fallback for other methods/paths
  return { statusCode: 404, body: 'Not found' };
}