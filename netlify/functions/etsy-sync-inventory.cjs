// netlify/functions/etsy-sync-inventory.cjs
// POST: Syncs Etsy inventory to Supabase Products table for the logged-in user

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
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
    // ...removed raw debugging...
  } catch (e) {
    console.error('[Etsy Sync] Failed to fetch tokens:', e);
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
    const refreshToken = row.refresh_token;
    const ETSY_CLIENT_ID = process.env.ETSY_CLIENT_ID;
    // ...removed raw debugging...
    async function refreshEtsyToken(row, supabase) {
      const refreshUrl = 'https://api.etsy.com/v3/public/oauth/token';
      const params = new URLSearchParams();
      params.append('grant_type', 'refresh_token');
      params.append('client_id', ETSY_CLIENT_ID);
      params.append('refresh_token', row.refresh_token);
      const resp = await fetch(refreshUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params
      });
      if (!resp.ok) {
        const errText = await resp.text();
        console.error('[Etsy Sync] Failed to refresh token:', resp.status, errText);
        return null;
      }
      const json = await resp.json();
      await supabase.from('oauth_tokens').update({
        access_token: json.access_token,
        refresh_token: json.refresh_token || row.refresh_token,
        expires_at: Math.floor(Date.now() / 1000) + (json.expires_in || 3600)
      }).eq('user_key', row.user_key).eq('platform', 'etsy');
      return json.access_token;
    }
    // Always fetch shop_id from Etsy API using the access token, refresh if expired
    let shopId;
    let shopResp = await fetch('https://openapi.etsy.com/v3/application/users/me', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'x-api-key': ETSY_CLIENT_ID
      }
    });
    // ...removed raw debugging...
    if (shopResp.status === 401) {
      console.warn(`[Etsy Sync] 401 Unauthorized for retailer ${retailer}, attempting token refresh`);
      const newToken = await refreshEtsyToken(row, supabase);
      if (!newToken) {
        const errText = await shopResp.text();
        console.error('[Etsy Sync] Token refresh failed, still 401:', errText);
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
      console.error(`[Etsy Sync] Failed to fetch user/me for retailer ${retailer}:`, shopResp.status, errText);
      continue;
    }
    const shopJson = await shopResp.json();
    if (shopJson && shopJson.shop_id) {
      shopId = shopJson.shop_id;
      // ...removed raw debugging...
    } else {
      console.error('[Etsy Sync] No shop_id found in getMe response');
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
        console.error(`[Etsy Sync] Failed to fetch listings for retailer ${retailer}:`, resp.status, await resp.text());
        break;
      }
      const json = await resp.json();
      if (json && Array.isArray(json.results)) {
        listings = listings.concat(json.results);
        total = typeof json.count === 'number' ? json.count : null;
      }
      offset += limit;
    } while (total !== null && listings.length < total);
    // ...removed raw debugging...
    // Get all SKUs from Supabase for this retailer
    let supaProducts = [];
    try {
      const { data: products, error: prodErr } = await supabase
        .from('Products')
        .select('ProductSKU,Quantity,Retailer')
        .eq('Retailer', retailer);
      if (prodErr) throw prodErr;
      supaProducts = (products || []).filter(p => retailersWithToken.has(p.Retailer));
      // ...removed raw debugging...
    } catch (e) {
      console.error(`[Etsy Sync] Supabase error for retailer ${retailer}:`, e);
      continue;
    }
    const skuToQty = {};
    for (const p of supaProducts) {
      skuToQty[p.ProductSKU] = parseInt(p.Quantity) || 0;
    }
    // ...removed raw debugging...
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
            // ...removed raw debugging...
          } else {
            const errText = await invResp.text();
            console.error(`[Etsy Sync] Failed to GET inventory for listing ${listing.listing_id}:`, invResp.status, errText);
          }
        } catch (err) {
          console.error(`[Etsy Sync] Exception fetching inventory for listing ${listing.listing_id}:`, err);
        }
      }
      // Always PATCH all products from GET inventory, updating only the quantities for SKUs being synced
      let products = [];
      if (inventory && Array.isArray(inventory.products)) {
        products = inventory.products.map(product => {
          // If this product's SKU is in listingSkus, update its quantity
          let newProduct = JSON.parse(JSON.stringify(product));
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
                  console.log(`[Etsy Sync] Bundle SKU ${product.sku} (all same: ${baseSku}) qty: ${bundleQty}`);
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
                  console.log(`[Etsy Sync] Bundle SKU ${product.sku} (mixed) qty: ${bundleQty}`);
                }
              }
            } else {
              const qty = skuToQty[product.sku];
              if (typeof qty === 'number' && !isNaN(qty)) {
                bundleQty = qty;
                console.log(`[Etsy Sync] SKU ${product.sku} qty: ${bundleQty}`);
              }
            }
            if (typeof bundleQty === 'number' && !isNaN(bundleQty)) {
              // Clamp negative quantities to zero
              if (Array.isArray(newProduct.offerings)) {
                newProduct.offerings = newProduct.offerings.map(o => {
                  let newOffering = { ...o, quantity: Math.max(0, bundleQty) };
                  // If price is a Money object, set price as Money object (amount, divisor, currency_code)
                  if (o.price && typeof o.price.amount === 'number' && typeof o.price.divisor === 'number' && typeof o.price.currency_code === 'string') {
                    newOffering.price = {
                      amount: o.price.amount,
                      divisor: o.price.divisor,
                      currency_code: o.price.currency_code
                    };
                  }
                  return newOffering;
                });
                console.log(`[Etsy Sync] Updated offerings for SKU ${product.sku}:`, newProduct.offerings.map(of => of.quantity));
              }
            } else {
              console.warn(`[Etsy Sync] No valid quantity for SKU ${product.sku} for retailer ${retailer}`);
            }
          }
          return newProduct;
        });
      }
      if (products.length > 0 && listing.listing_id) {
        // Only PATCH if listing is active
        if (listing.state && listing.state !== 'active') {
          console.log(`[Etsy Sync] Skipping PATCH for listing ${listing.listing_id} (state: ${listing.state})`);
          continue;
        }
        // PUT inventory to Etsy with top-level fields copied from GET response, replacing only products quantities
        const putUrl = `https://openapi.etsy.com/v3/application/listings/${listing.listing_id}/inventory`;
        let putBody = inventory ? JSON.parse(JSON.stringify(inventory)) : { products };
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
                    quantity: Math.max(0, bundleQty)
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
            console.error(`[Etsy Sync] Failed to PUT inventory for listing ${listing.listing_id} retailer ${retailer}:`, putResp.status, errText);
          }
        } catch (err) {
          console.error(`[Etsy Sync] Exception PUTting inventory for listing ${listing.listing_id} retailer ${retailer}:`, err);
        }
      }
      // Do not update Supabase etsy_quantity for each SKU (per user request)
    }
    totalUpdated += listings.length;
  }
  return {
    statusCode: 200,
    body: JSON.stringify({ updated: totalUpdated }),
    headers: { 'Content-Type': 'application/json' },
  };
};
