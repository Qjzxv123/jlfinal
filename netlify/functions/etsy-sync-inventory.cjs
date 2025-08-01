// netlify/functions/etsy-sync-inventory.cjs
// POST: Syncs Etsy inventory to Supabase Products table for the logged-in user

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  // Get Authorization header and SKUs from POST body
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
  let etsyToken = null;
  if (authHeader.startsWith('Bearer ')) etsyToken = authHeader.slice(7);
  let body = {};
  try { body = JSON.parse(event.body); } catch (e) { body = {}; }
  const selectedSkus = Array.isArray(body.skus) ? body.skus : [];
  const quantities = typeof body.quantities === 'object' && body.quantities !== null ? body.quantities : {};
  if (!etsyToken || selectedSkus.length === 0) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing Etsy token or SKUs to sync.' }),
    };
  }
  // Find the user_key for this token
  let retailer = null;
  try {
    const { data, error } = await supabase
      .from('oauth_tokens')
      .select('user_key,refresh_token')
      .eq('platform', 'etsy')
      .eq('access_token', etsyToken)
      .maybeSingle();
    if (error) throw error;
    retailer = data?.user_key || null;
    var refreshToken = data?.refresh_token || null;
  } catch (e) {
    return {
      statusCode: 403,
      body: JSON.stringify({ error: 'Invalid Etsy token.' }),
    };
  }
  if (!retailer) {
    return {
      statusCode: 403,
      body: JSON.stringify({ error: 'Etsy token not associated with any user.' }),
    };
  }
  const ETSY_CLIENT_ID = process.env.ETSY_CLIENT_ID;
  // Always fetch shop_id from Etsy API using the access token, refresh if expired
  let accessToken = etsyToken;
  async function refreshEtsyToken(refreshToken) {
    const refreshUrl = 'https://api.etsy.com/v3/public/oauth/token';
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('client_id', ETSY_CLIENT_ID);
    params.append('refresh_token', refreshToken);
    const resp = await fetch(refreshUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    await supabase.from('oauth_tokens').update({
      access_token: json.access_token,
      refresh_token: json.refresh_token || refreshToken,
      expires_at: Math.floor(Date.now() / 1000) + (json.expires_in || 3600)
    }).eq('user_key', retailer).eq('platform', 'etsy');
    return json.access_token;
  }
  let shopId;
  let shopResp = await fetch('https://openapi.etsy.com/v3/application/users/me', {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'x-api-key': ETSY_CLIENT_ID
    }
  });
  if (shopResp.status === 401 && refreshToken) {
    const newToken = await refreshEtsyToken(refreshToken);
    if (!newToken) {
      return {
        statusCode: 403,
        body: JSON.stringify({ error: 'Token refresh failed.' }),
      };
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
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to fetch user/me', details: await shopResp.text() }),
    };
  }
  const shopJson = await shopResp.json();
  if (!shopJson || !shopJson.shop_id) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'No shop_id found in getMe response.' }),
    };
  }
  shopId = shopJson.shop_id;
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
    if (!resp.ok) break;
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
    let listingSkus = [];
    if (Array.isArray(listing.skus)) {
      listingSkus = listing.skus;
    } else if (Array.isArray(listing.sku)) {
      listingSkus = listing.sku;
    } else if (typeof listing.sku === 'string') {
      listingSkus = [listing.sku];
    }
    // Only update SKUs that are in selectedSkus
    listingSkus = listingSkus.filter(sku => selectedSkus.includes(sku));
    if (listingSkus.length === 0) continue;
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
        }
      } catch (err) {}
    }
    let products = [];
    if (inventory && Array.isArray(inventory.products)) {
      products = inventory.products.map(product => {
        let newProduct = JSON.parse(JSON.stringify(product));
        if (listingSkus.includes(product.sku)) {
          let syncQty = quantities[product.sku];
          if (typeof syncQty !== 'number' || isNaN(syncQty)) {
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
                if (minQty !== null) bundleQty = minQty;
              }
            } else {
              const qty = skuToQty[product.sku];
              if (typeof qty === 'number' && !isNaN(qty)) {
                bundleQty = qty;
              }
            }
            syncQty = bundleQty;
          }
          if (typeof syncQty === 'number' && !isNaN(syncQty)) {
            if (Array.isArray(newProduct.offerings)) {
              newProduct.offerings = newProduct.offerings.map(o => ({
                ...o,
                quantity: Math.max(0, Math.min(999, syncQty))
              }));
            }
          }
        }
        // Remove forbidden keys from product
        delete newProduct.product_id;
        delete newProduct.is_deleted;
        if (Array.isArray(newProduct.offerings)) {
          newProduct.offerings = newProduct.offerings.map(offering => {
            const { offering_id, is_deleted, ...rest } = offering;
            let price = rest.price;
            if (price && typeof price === 'object' && typeof price.amount === 'number' && typeof price.divisor === 'number') {
              price = price.amount / price.divisor;
            }
            return { ...rest, price };
          });
        }
        if (Array.isArray(newProduct.property_values)) {
          newProduct.property_values = newProduct.property_values.map(pv => {
            const { scale_name, ...rest } = pv;
            return rest;
          });
        }
        return newProduct;
      });
    }
    if (products.length > 0 && listing.listing_id) {
      if (listing.state && listing.state !== 'active') continue;
      const putUrl = `https://openapi.etsy.com/v3/application/listings/${listing.listing_id}/inventory`;
      let putBody = inventory ? JSON.parse(JSON.stringify(inventory)) : { products };
      if (putBody && Array.isArray(putBody.products)) {
        putBody.products = putBody.products.map(product => {
          let newProduct = { ...product };
          if (listingSkus.includes(product.sku)) {
            let syncQty = quantities[product.sku];
            if (typeof syncQty !== 'number' || isNaN(syncQty)) {
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
                  if (minQty !== null) bundleQty = minQty;
                }
              } else {
                const qty = skuToQty[product.sku];
                if (typeof qty === 'number' && !isNaN(qty)) {
                  bundleQty = qty;
                }
              }
              syncQty = bundleQty;
            }
            if (typeof syncQty === 'number' && !isNaN(syncQty)) {
              if (Array.isArray(newProduct.offerings)) {
                newProduct.offerings = newProduct.offerings.map(o => ({
                  ...o,
                  quantity: Math.max(0, Math.min(999, syncQty))
                }));
              }
            }
          }
          delete newProduct.product_id;
          delete newProduct.is_deleted;
          if (Array.isArray(newProduct.offerings)) {
            newProduct.offerings = newProduct.offerings.map(offering => {
              const { offering_id, is_deleted, ...rest } = offering;
              let price = rest.price;
              if (price && typeof price === 'object' && typeof price.amount === 'number' && typeof price.divisor === 'number') {
                price = price.amount / price.divisor;
              }
              return { ...rest, price };
            });
          }
          if (Array.isArray(newProduct.property_values)) {
            newProduct.property_values = newProduct.property_values.map(pv => {
              const { scale_name, ...rest } = pv;
              return rest;
            });
          }
          return newProduct;
        });
      }
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
      } catch (err) {}
    }
  }
  return {
    statusCode: 200,
    body: JSON.stringify({ success: true }),
    headers: { 'Content-Type': 'application/json' },
  };
};
