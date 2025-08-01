let fetch = require('node-fetch');
if (fetch && fetch.default) fetch = fetch.default;
const { getTokenRow } = require('./faire-token-utils.cjs');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ypvyrophqkfqwpefuigi.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  // Get Authorization header and SKUs from POST body
  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
  let faireToken = null;
  if (authHeader.startsWith('Bearer ')) faireToken = authHeader.slice(7);
  let body = {};
  try { body = JSON.parse(event.body); } catch (e) { body = {}; }
  const selectedSkus = Array.isArray(body.skus) ? body.skus : [];
  const quantities = typeof body.quantities === 'object' && body.quantities !== null ? body.quantities : {};
  if (!faireToken || selectedSkus.length === 0) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing Faire token or SKUs to sync.' }),
    };
  }
  // Find the user_key for this token
  let retailer = null;
  try {
    const { data, error } = await supabase
      .from('oauth_tokens')
      .select('user_key')
      .eq('platform', 'faire')
      .eq('access_token', faireToken)
      .maybeSingle();
    if (error) throw error;
    retailer = data?.user_key || null;
  } catch (e) {
    return {
      statusCode: 403,
      body: JSON.stringify({ error: 'Invalid Faire token.' }),
    };
  }
  if (!retailer) {
    return {
      statusCode: 403,
      body: JSON.stringify({ error: 'Faire token not associated with any user.' }),
    };
  }
  // Get all products for this retailer
  let supaProducts = [];
  try {
    const { data: products, error: prodErr } = await supabase
      .from('Products')
      .select('ProductSKU,Quantity,Retailer')
      .eq('Retailer', retailer);
    if (prodErr) throw prodErr;
    supaProducts = products || [];
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to fetch products', details: e.message || e.toString() }),
    };
  }
  const skuToQty = {};
  for (const p of supaProducts) {
    skuToQty[p.ProductSKU] = parseInt(p.Quantity) || 0;
  }
  // PATCH only selected SKUs
  const patchPayload = { inventories: [] };
  for (const sku of selectedSkus) {
    // Use the quantity provided by the user, fallback to calculated bundle logic if not provided
    let syncQty = quantities[sku];
    if (typeof syncQty !== 'number' || isNaN(syncQty)) {
      let bundleQty = null;
      if (sku.includes('+')) {
        const parts = sku.split('+');
        if (parts.every(p => p === parts[0])) {
          const baseSku = parts[0];
          const baseQty = skuToQty[baseSku];
          if (typeof baseQty === 'number' && !isNaN(baseQty)) {
            bundleQty = Math.floor(baseQty / parts.length);
          }
        } else {
          let minQty = null;
          for (const part of parts) {
            const q = skuToQty[part];
            if (typeof q === 'number' && !isNaN(q)) {
              if (minQty === null || q < minQty) minQty = q;
            }
          }
          if (minQty !== null) bundleQty = minQty;
        }
      } else {
        const qty = skuToQty[sku];
        if (typeof qty === 'number' && !isNaN(qty)) bundleQty = qty;
      }
      syncQty = bundleQty;
    }
    if (typeof syncQty === 'number' && !isNaN(syncQty)) {
      patchPayload.inventories.push({ sku, on_hand_quantity: syncQty });
    }
  }
  // PATCH update to Faire
  const credentials = Buffer.from(`${process.env.FAIRE_CLIENT_ID}:${process.env.FAIRE_CLIENT_SECRET}`).toString('base64');
  const patchUrl = 'https://www.faire.com/external-api/v2/product-inventory/by-skus';
  const patchRes = await fetch(patchUrl, {
    method: 'PATCH',
    headers: {
      'X-FAIRE-APP-CREDENTIALS': credentials,
      'X-FAIRE-OAUTH-ACCESS-TOKEN': faireToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(patchPayload),
  });
  if (!patchRes.ok) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Faire PATCH error', details: await patchRes.text() }),
    };
  }
  return {
    statusCode: 200,
    body: JSON.stringify({ success: true }),
    headers: { 'Content-Type': 'application/json' },
  };
};
