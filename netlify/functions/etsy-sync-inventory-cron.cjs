// netlify/functions/etsy-sync-inventory-cron.cjs
// Scheduled function to sync Etsy inventory every 15 minutes

let fetch = require('node-fetch');
if (fetch && fetch.default) fetch = fetch.default;
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ETSY_CLIENT_ID = process.env.ETSY_CLIENT_ID;
const ETSY_CLIENT_SECRET = process.env.ETSY_CLIENT_SECRET;

async function invalidateEtsyToken(userKey, supabase) {
  try {
    await supabase
      .from('oauth_tokens')
      .update({
        access_token: null,
        refresh_token: null,
        expires_at: null
      })
      .eq('user_key', userKey)
      .eq('platform', 'etsy');
  } catch (err) {
    console.error('[Etsy Sync Cron] Failed to invalidate token for', userKey, err);
  }
}

exports.handler = async function(event) {
  console.log('[Etsy Sync Cron] Starting scheduled inventory sync');
  
  // Get all oauth tokens from Supabase
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  let tokenRows = [];
  try {
    const { data, error } = await supabase
      .from('oauth_tokens')
      .select('user_key,access_token,refresh_token')
      .eq('platform', 'etsy');
    if (error) throw error;
    tokenRows = data || [];
  } catch (e) {
    console.error('[Etsy Sync Cron] Failed to fetch tokens:', e);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to fetch tokens', details: e.message || e.toString() }),
    };
  }

  // Build a set of retailers with tokens for quick lookup
  const retailersWithToken = new Set(tokenRows.map(row => row.user_key));

  // For each token, fetch all inventory from Etsy and update Products table
  let totalUpdated = 0;
  for (const row of tokenRows) {
    const retailer = row.user_key;
    let accessToken = row.access_token;

    async function refreshEtsyToken(row, supabase) {
      if (!row.refresh_token) {
        console.error('[Etsy Sync Cron] Missing refresh_token for retailer', retailer);
        return null;
      }
      if (!ETSY_CLIENT_ID) {
        console.error('[Etsy Sync Cron] Missing ETSY_CLIENT_ID env var, cannot refresh');
        return null;
      }
      const refreshUrl = 'https://api.etsy.com/v3/public/oauth/token';
      const params = new URLSearchParams();
      params.append('grant_type', 'refresh_token');
      params.append('client_id', ETSY_CLIENT_ID);
      params.append('refresh_token', row.refresh_token);
      if (ETSY_CLIENT_SECRET) {
        params.append('client_secret', ETSY_CLIENT_SECRET);
      }
      const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
      const resp = await fetch(refreshUrl, {
        method: 'POST',
        headers,
        body: params
      });
      if (!resp.ok) {
        const errText = await resp.text();
        console.error('[Etsy Sync Cron] Failed to refresh token:', resp.status, errText);
        let errJson = null;
        try {
          errJson = JSON.parse(errText);
        } catch (_) {}
        if (resp.status === 400 && errJson?.error === 'invalid_grant') {
          console.error('[Etsy Sync Cron] Refresh token revoked for retailer', retailer);
          await invalidateEtsyToken(row.user_key, supabase);
          row.access_token = null;
          row.refresh_token = null;
          row.expires_at = null;
        }
        return null;
      }
      const json = await resp.json();
      const newAccessToken = json.access_token;
      const newRefreshToken = json.refresh_token || row.refresh_token;
      const newExpiry = Math.floor(Date.now() / 1000) + (json.expires_in || 3600);

      await supabase.from('oauth_tokens').update({
        access_token: newAccessToken,
        refresh_token: newRefreshToken,
        expires_at: newExpiry
      }).eq('user_key', row.user_key).eq('platform', 'etsy');

      // synchronize in-memory token data so subsequent refreshes use the new refresh token
      row.access_token = newAccessToken;
      row.refresh_token = newRefreshToken;
      row.expires_at = newExpiry;

      return newAccessToken;
    }
    
    // Always fetch shop_id from Etsy API using the access token, refresh if expired
    let shopId;
    let shopResp = await fetch('https://openapi.etsy.com/v3/application/users/me', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'x-api-key': ETSY_CLIENT_ID
      }
    });
    
    if (shopResp.status === 401) {
      console.warn(`[Etsy Sync Cron] 401 Unauthorized for retailer ${retailer}, attempting token refresh`);
      const newToken = await refreshEtsyToken(row, supabase);
      if (!newToken) {
        const errText = await shopResp.text();
        console.error('[Etsy Sync Cron] Token refresh failed, still 401:', errText);
        continue;
      }
      accessToken = newToken;
      shopResp = await fetch('https://openapi.etsy.com/v3/application/users/me', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'x-api-key': ETSY_CLIENT_ID
        }
      });
    }
    
    if (!shopResp.ok) {
      const errText = await shopResp.text();
      console.error(`[Etsy Sync Cron] Failed to fetch user/me for retailer ${retailer}:`, shopResp.status, errText);
      continue;
    }
    
    const shopJson = await shopResp.json();
    if (shopJson && shopJson.shop_id) {
      shopId = shopJson.shop_id;
    } else {
      console.error('[Etsy Sync Cron] No shop_id found in getMe response');
      continue;
    }
    
    // Fetch all listings from Etsy
    let listings = [];
    let offset = 0;
    const limit = 100;
    let total = null;
    do {
      const resp = await fetch(`https://openapi.etsy.com/v3/application/shops/${shopId}/listings/active?limit=${limit}&offset=${offset}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'x-api-key': ETSY_CLIENT_ID
          }
        });
      if (!resp.ok) {
        console.error(`[Etsy Sync Cron] Failed to fetch listings for retailer ${retailer}:`, resp.status, await resp.text());
        break;
      }
      const json = await resp.json();
      if (json && Array.isArray(json.results)) {
        listings = listings.concat(json.results);
        total = typeof json.count === 'number' ? json.count : null;
      }
      offset += limit;
    } while (total !== null && listings.length < total);
    
    // Get all SKUs from Supabase for this retailer
    let supaProducts = [];
    try {
      const { data: products, error: prodErr } = await supabase
        .from('Products')
        .select('ProductSKU,Quantity,Retailer,ReserveQuantity')
        .eq('Retailer', retailer);
      if (prodErr) throw prodErr;
      supaProducts = (products || []).filter(p => retailersWithToken.has(p.Retailer));
    } catch (e) {
      console.error(`[Etsy Sync Cron] Supabase error for retailer ${retailer}:`, e);
      continue;
    }
    const skuToQty = {};
    for (const p of supaProducts) {
      const totalQty = parseInt(p.Quantity) || 0;
      const reserveQty = parseInt(p.ReserveQuantity) || 0;
      const availableQty = Math.max(0, totalQty - reserveQty); // Ensure non-negative
      skuToQty[p.ProductSKU] = availableQty;
    }
    
    // Gather all SKUs from Etsy listings
    let allSkus = [];
    for (const listing of listings) {
      if (Array.isArray(listing.skus)) {
        allSkus = allSkus.concat(listing.skus);
      } else if (Array.isArray(listing.sku)) {
        allSkus = allSkus.concat(listing.sku);
      } else if (typeof listing.sku === 'string') {
        allSkus.push(listing.sku);
      }
    }
    const uniqueSkus = Array.from(new Set(allSkus));
    
    // For each listing, update inventory on Etsy using the inventory endpoint
    let listingsUpdated = 0;
    for (const listing of listings) {
      // Gather all SKUs for this listing
      let listingSkus = [];
      if (Array.isArray(listing.skus)) {
        listingSkus = listing.skus;
      } else if (Array.isArray(listing.sku)) {
        listingSkus = listing.sku;
      } else if (typeof listing.sku === 'string') {
        listingSkus = [listing.sku];
      }
      
      // Fetch current inventory for this listing from Etsy
      let inventory = null;
      if (listing.listing_id) {
        const getInvUrl = `https://openapi.etsy.com/v3/application/listings/${listing.listing_id}/inventory`;
        try {
          const invResp = await fetch(getInvUrl, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'x-api-key': ETSY_CLIENT_ID
            }
          });
          if (invResp.ok) {
            inventory = await invResp.json();
          } else {
            const errText = await invResp.text();
            console.error(`[Etsy Sync Cron] Failed to GET inventory for listing ${listing.listing_id}:`, invResp.status, errText);
          }
        } catch (err) {
          console.error(`[Etsy Sync Cron] Exception fetching inventory for listing ${listing.listing_id}:`, err);
        }
      }
      
      // Update inventory if we have it
      if (inventory && Array.isArray(inventory.products) && inventory.products.length > 0 && listing.listing_id) {
        // Only PATCH if listing is active
        if (listing.state && listing.state !== 'active') {
          console.log(`[Etsy Sync Cron] Skipping PATCH for listing ${listing.listing_id} (state: ${listing.state})`);
          continue;
        }
        
        // PUT inventory to Etsy with top-level fields copied from GET response, replacing only products quantities
        const putUrl = `https://openapi.etsy.com/v3/application/listings/${listing.listing_id}/inventory`;
        let putBody = JSON.parse(JSON.stringify(inventory));
        
        if (putBody && Array.isArray(putBody.products)) {
          putBody.products = putBody.products.map(product => {
            let newProduct = { ...product };
            if (listingSkus.includes(product.sku)) {
              // Calculate bundleQty for this SKU
              let bundleQty = null;
              let parts = null;
              if (product.sku && product.sku.includes('+')) {
                parts = product.sku.split('+').map(p => p.trim());
              }
              if (parts && parts.length > 1) {
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
                  if (minQty !== null) {
                    bundleQty = minQty;
                  }
                }
              } else {
                const qty = skuToQty[product.sku];
                if (typeof qty === 'number' && !isNaN(qty)) {
                  bundleQty = qty;
                }
              }
              if (typeof bundleQty === 'number' && !isNaN(bundleQty)) {
                if (Array.isArray(newProduct.offerings)) {
                  newProduct.offerings = newProduct.offerings.map(o => ({
                    ...o,
                    quantity: Math.max(0, Math.min(999, bundleQty))
                  }));
                }
              }
            }
            // Remove forbidden keys from product
            delete newProduct.product_id;
            delete newProduct.is_deleted;
            // Remove forbidden keys from offerings and convert price to float
            if (Array.isArray(newProduct.offerings)) {
              newProduct.offerings = newProduct.offerings.map(offering => {
                const { offering_id, is_deleted, ...rest } = offering;
                // Convert price from Money object to float if needed
                let price = rest.price;
                if (price && typeof price === 'object' && typeof price.amount === 'number' && typeof price.divisor === 'number') {
                  price = price.amount / price.divisor;
                }
                return { ...rest, price };
              });
            }
            // Remove scale_name from property_values
            if (Array.isArray(newProduct.property_values)) {
              newProduct.property_values = newProduct.property_values.map(pv => {
                const { scale_name, ...rest } = pv;
                return rest;
              });
            }
            return newProduct;
          });
        }
        
        // Only include *_on_property fields if non-empty arrays
        ['price_on_property','quantity_on_property','sku_on_property','readiness_state_on_property'].forEach(key => {
          if (putBody[key] && Array.isArray(putBody[key]) && putBody[key].length === 0) {
            delete putBody[key];
          }
        });
        
        try {
          const putResp = await fetch(putUrl, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'x-api-key': ETSY_CLIENT_ID,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(putBody),
          });
          if (!putResp.ok) {
            const errText = await putResp.text();
            console.error(`[Etsy Sync Cron] Failed to PUT inventory for listing ${listing.listing_id} retailer ${retailer}:`, putResp.status, errText);
          } else {
            listingsUpdated++;
          }
        } catch (err) {
          console.error(`[Etsy Sync Cron] Exception PUTting inventory for listing ${listing.listing_id} retailer ${retailer}:`, err);
        }
      }
    }
    
    console.log(`[Etsy Sync Cron] Successfully synced ${listingsUpdated} listings for retailer ${retailer}`);
    totalUpdated += listingsUpdated;
  }
  
  console.log(`[Etsy Sync Cron] Completed sync for ${tokenRows.length} retailers, ${totalUpdated} total listings updated`);
  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Etsy inventory sync completed', updated: totalUpdated }),
    headers: { 'Content-Type': 'application/json' },
  };
};
