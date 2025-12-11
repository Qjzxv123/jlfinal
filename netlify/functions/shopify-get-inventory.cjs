// netlify/functions/shopify-get-inventory.cjs
// POST { skus: ["SKU1", ...] }
// Header: x-shopify-domain: yourstore.myshopify.com
// Returns: { SKU1: quantity | '' | null, ... }

const { createClient } = require('@supabase/supabase-js');
let fetch = require('node-fetch');
if (fetch && fetch.default) fetch = fetch.default;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let skus = [];
  try {
    const body = JSON.parse(event.body || '{}');
    if (!Array.isArray(body.skus)) throw new Error('skus must be an array');
    skus = body.skus.filter(Boolean);
  } catch (e) {
    return { statusCode: 400, body: 'Invalid request: ' + e.message };
  }
  if (!skus.length) {
    return { statusCode: 400, body: 'No SKUs provided' };
  }

  const shopDomain = event.headers['x-shopify-domain'] || event.headers['X-Shopify-Domain'];
  if (!shopDomain) {
    return { statusCode: 400, body: 'Missing x-shopify-domain header' };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Fetch Shopify token by ShopifyDomain, fall back to user_key
  let tokenRow = null;
  try {
    const { data, error } = await supabase
      .from('oauth_tokens')
      .select('*')
      .eq('platform', 'shopify')
      .eq('ShopifyDomain', shopDomain)
      .maybeSingle();
    if (!error && data) tokenRow = data;
    if (!tokenRow) {
      const { data: fallback, error: fallbackError } = await supabase
        .from('oauth_tokens')
        .select('*')
        .eq('platform', 'shopify')
        .eq('user_key', shopDomain)
        .maybeSingle();
      if (!fallbackError && fallback) tokenRow = fallback;
    }
  } catch (err) {
    console.error('[Shopify Inventory] Supabase query failed:', err);
  }

  if (!tokenRow || !tokenRow.access_token) {
    return { statusCode: 401, body: 'No Shopify token found for domain' };
  }

  const accessToken = tokenRow.access_token;
  const baseUrl = `https://${shopDomain}`;
  const requested = new Set(skus);
  const results = {};
  skus.forEach(s => { results[s] = ''; });

  let nextUrl = `${baseUrl}/admin/api/2023-10/products.json?limit=250&fields=id,variants`;
  let safetyCounter = 0;

  try {
    while (nextUrl && safetyCounter < 10 && requested.size > 0) {
      safetyCounter += 1;
      const res = await fetch(nextUrl, {
        method: 'GET',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        }
      });
      if (!res.ok) {
        console.error('[Shopify Inventory] API error', res.status, await res.text());
        break;
      }
      const data = await res.json();
      if (data && Array.isArray(data.products)) {
        for (const product of data.products) {
          if (!Array.isArray(product.variants)) continue;
          for (const variant of product.variants) {
            const sku = variant.sku;
            if (sku && requested.has(sku)) {
              // inventory_quantity is the on-hand quantity for the variant
              const qty = typeof variant.inventory_quantity === 'number' ? variant.inventory_quantity : '';
              results[sku] = qty;
              requested.delete(sku);
            }
          }
        }
      }

      // Pagination via Link header (page_info)
      const linkHeader = res.headers.get('link') || res.headers.get('Link');
      if (linkHeader && linkHeader.includes('rel="next"')) {
        const match = linkHeader.split(',').find(part => part.includes('rel="next"'));
        if (match) {
          const urlMatch = match.match(/<([^>]+)>/);
          if (urlMatch && urlMatch[1]) {
            nextUrl = urlMatch[1];
          } else {
            nextUrl = null;
          }
        } else {
          nextUrl = null;
        }
      } else {
        nextUrl = null;
      }
    }
  } catch (err) {
    console.error('[Shopify Inventory] Unexpected error:', err);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(results)
  };
};
