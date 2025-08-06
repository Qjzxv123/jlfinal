// netlify/functions/faire-sync-inventory-cron.cjs
// Scheduled function to sync Faire inventory every 15 minutes

let fetch = require('node-fetch');
if (fetch && fetch.default) fetch = fetch.default;
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ypvyrophqkfqwpefuigi.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

exports.handler = async function(event, context) {
  console.log('[Faire Sync Cron] Starting scheduled inventory sync');

  // Get all oauth tokens from Supabase
  let tokenRows = [];
  try {
    const { data, error } = await supabase
      .from('oauth_tokens')
      .select('user_key,access_token')
      .eq('platform', 'faire');
    if (error) throw error;
    tokenRows = data || [];
  } catch (e) {
    console.error('[Faire Sync Cron] Failed to fetch tokens:', e);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to fetch tokens', details: e.message || e.toString() }),
    };
  }

  // Build a set of retailers with tokens for quick lookup
  const retailersWithToken = new Set(tokenRows.map(row => row.user_key));

  // For each token, fetch all inventory from Faire, calculate bundle logic, then PATCH updates
  const results = {};
  for (const row of tokenRows) {
    const retailer = row.user_key;
    const token = row.access_token;
    const credentials = Buffer.from(`${process.env.FAIRE_CLIENT_ID}:${process.env.FAIRE_CLIENT_SECRET}`).toString('base64');
    try {
      // 1. Get all products (and variants) for this retailer
      let allSkus = [];
      let cursor = null;
      do {
        let url = 'https://www.faire.com/external-api/v2/products?limit=250';
        if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
        const prodRes = await fetch(url, {
          method: 'GET',
          headers: {
            'X-FAIRE-APP-CREDENTIALS': credentials,
            'X-FAIRE-OAUTH-ACCESS-TOKEN': token,
          },
        });
        if (!prodRes.ok) {
          console.error(`[Faire Sync Cron] Faire products API error for retailer ${retailer}:`, prodRes.status, await prodRes.text());
          break;
        }
        const prodData = await prodRes.json();
        if (Array.isArray(prodData.products)) {
          for (const product of prodData.products) {
            if (Array.isArray(product.variants)) {
              for (const variant of product.variants) {
                if (variant.sku) allSkus.push(variant.sku);
              }
            }
          }
        }
        cursor = prodData.cursor || null;
      } while (cursor);

      // 2. Get all SKUs from Supabase for this retailer ONLY if retailer has a token
      let supaProducts = [];
      try {
        const { data: products, error: prodErr } = await supabase
          .from('Products')
          .select('ProductSKU,Quantity,Retailer,ReserveQuantity')
          .eq('Retailer', retailer);
        if (prodErr) throw prodErr;
        supaProducts = (products || []).filter(p => retailersWithToken.has(p.Retailer));
      } catch (e) {
        console.error(`[Faire Sync Cron] Supabase error for retailer ${retailer}:`, e);
        continue;
      }
      const skuToQty = {};
      for (const p of supaProducts) {
        const totalQty = parseInt(p.Quantity) || 0;
        const reserveQty = parseInt(p.ReserveQuantity) || 0;
        const availableQty = Math.max(0, totalQty - reserveQty); // Ensure non-negative
        skuToQty[p.ProductSKU] = availableQty;
      }
      // 3. For each Faire SKU, determine bundle logic and build update payload (deduplicate SKUs)
      const uniqueSkus = Array.from(new Set(allSkus));
      const patchPayload = { inventories: [] };
      for (const sku of uniqueSkus) {
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
        results[`${retailer}:${sku}`] = bundleQty;
        if (typeof bundleQty === 'number' && !isNaN(bundleQty)) {
          patchPayload.inventories.push({ sku, on_hand_quantity: bundleQty });
        }
      }
      // 4. PATCH update to Faire
      const patchUrl = 'https://www.faire.com/external-api/v2/product-inventory/by-skus';
      const patchRes = await fetch(patchUrl, {
        method: 'PATCH',
        headers: {
          'X-FAIRE-APP-CREDENTIALS': credentials,
          'X-FAIRE-OAUTH-ACCESS-TOKEN': token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(patchPayload),
      });
      if (!patchRes.ok) {
        console.error(`[Faire Sync Cron] Faire PATCH error for retailer ${retailer}:`, patchRes.status, await patchRes.text());
      } else {
        console.log(`[Faire Sync Cron] Successfully synced ${patchPayload.inventories.length} items for retailer ${retailer}`);
      }
    } catch (e) {
      console.error(`[Faire Sync Cron] Faire API exception for retailer ${retailer}:`, e);
      continue;
    }
  }
  
  console.log(`[Faire Sync Cron] Completed sync for ${tokenRows.length} retailers`);
  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Faire inventory sync completed', results }),
    headers: { 'Content-Type': 'application/json' },
  };
};
