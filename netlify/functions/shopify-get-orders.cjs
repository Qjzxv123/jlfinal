// netlify/functions/shopify-get-orders.cjs
// POST body options:
// {
//   "status": "any" | "open" | "closed" | "cancelled", // optional, default "any"
//   "financial_status": "paid" | "pending" | ...,        // optional
//   "fulfillment_status": "fulfilled" | "unfulfilled" | ..., // optional
//   "updated_at_min": "2024-01-01T00:00:00Z",                // optional ISO string
//   "limit": 50,                                             // optional, 1-250
//   "page_info": "..."                                      // optional for cursor pagination
// }
// Header: x-shopify-domain: yourstore.myshopify.com
// Returns: { orders: [...], next_page_info: string | null }

const { createClient } = require('@supabase/supabase-js');
let fetch = require('node-fetch');
if (fetch && fetch.default) fetch = fetch.default;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let options = {};
  try {
    options = JSON.parse(event.body || '{}') || {};
  } catch (e) {
    return { statusCode: 400, body: 'Invalid JSON body' };
  }

  const shopDomain = event.headers['x-shopify-domain'] || event.headers['X-Shopify-Domain'];
  if (!shopDomain) {
    return { statusCode: 400, body: 'Missing x-shopify-domain header' };
  }

  const limit = Math.min(Math.max(parseInt(options.limit) || 50, 1), 250);
  const status = options.status || 'any';
  const financialStatus = options.financial_status || undefined;
  const fulfillmentStatus = options.fulfillment_status || undefined;
  const updatedAtMin = options.updated_at_min || undefined;
  const pageInfo = options.page_info || undefined;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Fetch Shopify token by ShopifyDomain, fall back to user_key match
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
    console.error('[Shopify Get Orders] Supabase query failed:', err);
    return { statusCode: 500, body: 'Failed to query tokens' };
  }

  if (!tokenRow || !tokenRow.access_token) {
    return { statusCode: 401, body: 'No Shopify token found for domain' };
  }

  const accessToken = tokenRow.access_token;
  const baseUrl = `https://${shopDomain}`;

  // Build query params
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  params.set('status', status);
  if (financialStatus) params.set('financial_status', financialStatus);
  if (fulfillmentStatus) params.set('fulfillment_status', fulfillmentStatus);
  if (updatedAtMin) params.set('updated_at_min', updatedAtMin);
  if (pageInfo) params.set('page_info', pageInfo);
  // Return a concise set of fields to keep payload small
  params.set('fields', [
    'id','name','email','created_at','updated_at','currency','total_price','subtotal_price',
    'financial_status','fulfillment_status','cancelled_at','closed_at','order_number',
    'line_items','shipping_address','billing_address','tags','note','customer'
  ].join(','));

  const url = `${baseUrl}/admin/api/2023-10/orders.json?${params.toString()}`;

  let orders = [];
  let nextPageInfo = null;

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      }
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error('[Shopify Get Orders] API error', res.status, errText);
      return { statusCode: res.status, body: errText || 'Shopify API error' };
    }

    const data = await res.json();
    if (data && Array.isArray(data.orders)) {
      orders = data.orders;
    }

    // Parse Link header for pagination
    const linkHeader = res.headers.get('link') || res.headers.get('Link');
    if (linkHeader && linkHeader.includes('rel="next"')) {
      const nextPart = linkHeader.split(',').find(part => part.includes('rel="next"'));
      const match = nextPart && nextPart.match(/page_info=([^&>]+)/);
      if (match && match[1]) {
        nextPageInfo = match[1];
      }
    }
  } catch (err) {
    console.error('[Shopify Get Orders] Unexpected error:', err);
    return { statusCode: 500, body: 'Unexpected error fetching orders' };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orders, next_page_info: nextPageInfo })
  };
};
