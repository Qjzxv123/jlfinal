// netlify/functions/shopify-sync-inventory-cron.cjs
// Scheduled function to sync Shopify inventory every 15 minutes

let fetch = require('node-fetch');
if (fetch && fetch.default) fetch = fetch.default;
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ypvyrophqkfqwpefuigi.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

exports.handler = async function(event, context) {
  console.log('[Shopify Sync Cron] Starting scheduled inventory sync');

  // Get all oauth tokens from Supabase
  let tokenRows = [];
  try {
    const { data, error } = await supabase
      .from('oauth_tokens')
      .select('user_key,access_token,ShopifyDomain')
      .eq('platform', 'shopify');
    if (error) throw error;
    tokenRows = data || [];
  } catch (e) {
    console.error('[Shopify Sync Cron] Failed to fetch tokens:', e);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to fetch tokens', details: e.message || e.toString() }),
    };
  }

  // Build a set of retailers with tokens for quick lookup
  const retailersWithToken = new Set(tokenRows.map(row => row.user_key));

  // For each token, fetch all products from Shopify, calculate bundle logic, then update inventory
  const results = {};
  let totalUpdated = 0;
  
  for (const row of tokenRows) {
    const retailer = row.user_key;
    const token = row.access_token;
    const shopDomain = row.ShopifyDomain || retailer;
    const baseUrl = `https://${shopDomain}`;
    
    try {
      // 1. Get all products (and variants) for this retailer from Shopify
      let allVariants = [];
      let nextUrl = `${baseUrl}/admin/api/2023-10/products.json?limit=250`;
      let safetyCounter = 0;
      
      while (nextUrl && safetyCounter < 100) {
        safetyCounter += 1;
        const prodRes = await fetch(nextUrl, {
          method: 'GET',
          headers: {
            'X-Shopify-Access-Token': token,
            'Content-Type': 'application/json'
          }
        });
        
        if (!prodRes.ok) {
          console.error(`[Shopify Sync Cron] Shopify products API error for retailer ${retailer}:`, prodRes.status, await prodRes.text());
          break;
        }
        
        const prodData = await prodRes.json();
        if (prodData && Array.isArray(prodData.products)) {
          for (const product of prodData.products) {
            if (Array.isArray(product.variants)) {
              allVariants = allVariants.concat(product.variants);
            }
          }
        }
        
        // Pagination via Link header
        const linkHeader = prodRes.headers.get('link') || prodRes.headers.get('Link');
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
        console.error(`[Shopify Sync Cron] Supabase error for retailer ${retailer}:`, e);
        continue;
      }
      
      const skuToQty = {};
      for (const p of supaProducts) {
        const totalQty = parseInt(p.Quantity) || 0;
        const reserveQty = parseInt(p.ReserveQuantity) || 0;
        const availableQty = Math.max(0, totalQty - reserveQty); // Ensure non-negative
        skuToQty[p.ProductSKU] = availableQty;
      }

      // 3. For each Shopify variant, determine bundle logic and update inventory
      let variantsUpdated = 0;
      for (const variant of allVariants) {
        const sku = variant.sku;
        if (!sku) continue;
        
        let bundleQty = null;
        
        // Check if this is a bundle SKU (contains +)
        if (sku.includes('+')) {
          const parts = sku.split('+');
          
          // Check if all parts are the same (e.g., SKU1+SKU1+SKU1)
          if (parts.every(p => p === parts[0])) {
            const baseSku = parts[0];
            const baseQty = skuToQty[baseSku];
            if (typeof baseQty === 'number' && !isNaN(baseQty)) {
              bundleQty = Math.floor(baseQty / parts.length);
            }
          } else {
            // Different parts: use minimum quantity
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
          // Regular SKU
          const qty = skuToQty[sku];
          if (typeof qty === 'number' && !isNaN(qty)) bundleQty = qty;
        }
        
        results[`${retailer}:${sku}`] = bundleQty;
        
        // Update inventory on Shopify if we have a valid quantity
        if (typeof bundleQty === 'number' && !isNaN(bundleQty) && variant.inventory_item_id) {
          // Get the inventory level location first
          const locUrl = `${baseUrl}/admin/api/2023-10/inventory_levels.json?inventory_item_ids=${variant.inventory_item_id}`;
          const locRes = await fetch(locUrl, {
            method: 'GET',
            headers: {
              'X-Shopify-Access-Token': token,
              'Content-Type': 'application/json'
            }
          });
          
          if (!locRes.ok) {
            console.error(`[Shopify Sync Cron] Failed to get inventory location for variant ${variant.id}:`, locRes.status);
            continue;
          }
          
          const locData = await locRes.json();
          if (!locData || !Array.isArray(locData.inventory_levels) || locData.inventory_levels.length === 0) {
            console.error(`[Shopify Sync Cron] No inventory location found for variant ${variant.id}`);
            continue;
          }
          
          const locationId = locData.inventory_levels[0].location_id;
          
          // Set the inventory level
          const setUrl = `${baseUrl}/admin/api/2023-10/inventory_levels/set.json`;
          const setRes = await fetch(setUrl, {
            method: 'POST',
            headers: {
              'X-Shopify-Access-Token': token,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              location_id: locationId,
              inventory_item_id: variant.inventory_item_id,
              available: bundleQty
            })
          });
          
          if (!setRes.ok) {
            console.error(`[Shopify Sync Cron] Failed to set inventory for variant ${variant.id}:`, setRes.status, await setRes.text());
          } else {
            variantsUpdated++;
          }
        }
      }
      
      console.log(`[Shopify Sync Cron] Successfully synced ${variantsUpdated} variants for retailer ${retailer}`);
      totalUpdated += variantsUpdated;
    } catch (e) {
      console.error(`[Shopify Sync Cron] Shopify API exception for retailer ${retailer}:`, e);
      continue;
    }
  }
  
  console.log(`[Shopify Sync Cron] Completed sync for ${tokenRows.length} retailers, ${totalUpdated} total variants updated`);
  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Shopify inventory sync completed', updated: totalUpdated, results }),
    headers: { 'Content-Type': 'application/json' },
  };
};
