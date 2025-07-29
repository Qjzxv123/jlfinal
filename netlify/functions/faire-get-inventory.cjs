let fetch = require('node-fetch');
if (fetch && fetch.default) fetch = fetch.default;
const { getTokenRow } = require('./faire-token-utils.cjs');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ypvyrophqkfqwpefuigi.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

exports.handler = async function(event, context) {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  let skus = [];
  if (event.httpMethod === 'GET') {
    const url = new URL(event.rawUrl || `http://localhost${event.path}${event.rawQuery ? '?' + event.rawQuery : ''}`);
    const sku = url.searchParams.get('sku');
    if (sku) skus = [sku];
  } else if (event.httpMethod === 'POST') {
    try {
      const body = JSON.parse(event.body || '{}');
      if (Array.isArray(body.skus)) {
        skus = body.skus.filter(Boolean);
      }
    } catch (e) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid JSON' }),
      };
    }
  }
  if (!skus.length) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'No SKU(s) provided' }),
    };
  }

  // Fetch Products for all SKUs from Supabase
  let productRows = [];
  try {
    const { data: products, error } = await supabase
      .from('Products')
      .select('ProductSKU,Retailer')
      .in('ProductSKU', skus);
    if (error) throw error;
    productRows = products || [];
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to fetch Products from Supabase', details: e.message || e.toString() }),
    };
  }

  // Map SKU to retailer
  const skuToRetailer = {};
  for (const row of productRows) {
    if (row.ProductSKU && row.Retailer) skuToRetailer[row.ProductSKU] = row.Retailer;
  }
  // For each unique retailer, get their Faire access token
  const retailerToToken = {};
  const uniqueRetailers = [...new Set(Object.values(skuToRetailer))];
  for (const retailer of uniqueRetailers) {
    try {
      const tokenRow = await getTokenRow(retailer);
      retailerToToken[retailer] = tokenRow && tokenRow.access_token ? tokenRow.access_token : null;
      // Only keep retailers with a valid token
    } catch (e) {
      retailerToToken[retailer] = null;
    }
  }

  // Filter out SKUs whose retailer does not have a Faire access token
  const filteredRetailerToSkus = {};
  for (const sku of skus) {
    const retailer = skuToRetailer[sku];
    if (retailer && retailerToToken[retailer]) {
      if (!filteredRetailerToSkus[retailer]) filteredRetailerToSkus[retailer] = [];
      filteredRetailerToSkus[retailer].push(sku);
    }
  }

  // Batch SKUs by retailer and fetch inventory for each retailer in one call
  const retailerToSkus = {};
  for (const sku of skus) {
    const retailer = skuToRetailer[sku];
    if (retailer) {
      if (!retailerToSkus[retailer]) retailerToSkus[retailer] = [];
      retailerToSkus[retailer].push(sku);
    }
  }

  const results = {};
  // For SKUs with no retailer, set blank result
  for (const sku of skus) {
    if (!skuToRetailer[sku]) results[sku] = '';
  }

  await Promise.all(Object.entries(filteredRetailerToSkus).map(async ([retailer, skuList]) => {
    const token = retailerToToken[retailer];
    if (!retailer || !token) {
      for (const sku of skuList) results[sku] = '';
      return;
    }
    try {
      const credentials = Buffer.from(`${process.env.FAIRE_CLIENT_ID}:${process.env.FAIRE_CLIENT_SECRET}`).toString('base64');
      const params = skuList.map(sku => `skus=${encodeURIComponent(sku)}`).join('&');
      const url = `https://www.faire.com/external-api/v2/product-inventory/by-skus?${params}`;
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'X-FAIRE-APP-CREDENTIALS': credentials,
          'X-FAIRE-OAUTH-ACCESS-TOKEN': token,
        },
      });
      if (!res.ok) {
        for (const sku of skuList) results[sku] = '';
        return;
      }
      const data = await res.json();
      if (data.inventories && typeof data.inventories === 'object') {
        for (const sku of skuList) {
          const inv = data.inventories[sku];
          if (inv && inv.available_quantity && typeof inv.available_quantity.quantity === 'number') {
            results[sku] = inv.available_quantity.quantity;
          } else if (inv && inv.on_hand_quantity && typeof inv.on_hand_quantity.quantity === 'number') {
            results[sku] = inv.on_hand_quantity.quantity;
          } else {
            results[sku] = '';
          }
        }
      } else {
        for (const sku of skuList) results[sku] = '';
      }
    } catch (e) {
      for (const sku of skuList) results[sku] = '';
    }
  }));

  // If only one SKU and GET, return as { inventory: ... }
  if (event.httpMethod === 'GET' && skus.length === 1) {
    return {
      statusCode: 200,
      body: JSON.stringify({ inventory: results[skus[0]] }),
      headers: { 'Content-Type': 'application/json' },
    };
  }
  // Otherwise, return mapping { sku1: inv1, sku2: inv2, ... }
  return {
    statusCode: 200,
    body: JSON.stringify(results),
    headers: { 'Content-Type': 'application/json' },
  };
};