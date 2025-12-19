// netlify/functions/etsy-get-inventory.cjs
// POST { skus: ["sku1", "sku2", ...] }
// Returns: { sku1: quantity, sku2: quantity, ... }

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
    console.error('[Etsy Inventory] Failed to invalidate revoked token for', userKey, err);
  }
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  let skus;
  try {
    skus = JSON.parse(event.body).skus;
    if (!Array.isArray(skus)) throw new Error('skus must be array');
  } catch (e) {
    return { statusCode: 400, body: 'Invalid request: ' + e.message };
  }

  // Use x-etsy-user-key header to look up the correct oauth_token (Retailer logic)
  const userKey = event.headers['x-etsy-user-key'] || event.headers['X-Etsy-User-Key'];
  if (!userKey) {
    return { statusCode: 400, body: 'Missing x-etsy-user-key header' };
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  // Get Etsy token for user_key
  let { data: tokenRow, error } = await supabase
    .from('oauth_tokens')
    .select('*')
    .eq('user_key', userKey)
    .eq('platform', 'etsy')
    .maybeSingle();
  if (error || !tokenRow) {
    console.error('[Etsy Inventory] No Etsy token found for user_key:', userKey, 'Error:', error);
    return { statusCode: 401, body: 'No Etsy token found for user_key' };
  }
  // Use access token from tokenRow, refresh if expired (inline refresh logic)
  let accessToken = tokenRow.access_token;
  let shopId;
  async function refreshEtsyToken(tokenRow, supabase) {
    // Etsy uses OAuth2 refresh_token grant
    if (!tokenRow.refresh_token) {
      console.error('[Etsy Inventory] Missing refresh_token for user_key:', tokenRow.user_key);
      return null;
    }
    if (!ETSY_CLIENT_ID) {
      console.error('[Etsy Inventory] Missing ETSY_CLIENT_ID env var, cannot refresh token');
      return null;
    }
    const refreshUrl = 'https://api.etsy.com/v3/public/oauth/token';
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('client_id', ETSY_CLIENT_ID);
    params.append('refresh_token', tokenRow.refresh_token);
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
      console.error('[Etsy Inventory] Failed to refresh token:', resp.status, errText);
      let errJson = null;
      try {
        errJson = JSON.parse(errText);
      } catch (_) {}
      if (resp.status === 400 && errJson?.error === 'invalid_grant') {
        console.error('[Etsy Inventory] Refresh token revoked for user_key:', tokenRow.user_key);
        await invalidateEtsyToken(tokenRow.user_key, supabase);
      }
      return null;
    }
    const json = await resp.json();
    // Update token in DB
    const newAccessToken = json.access_token;
    const newRefreshToken = json.refresh_token || tokenRow.refresh_token;
    const newExpiry = Math.floor(Date.now() / 1000) + (json.expires_in || 3600);

    await supabase.from('oauth_tokens').update({
      access_token: newAccessToken,
      refresh_token: newRefreshToken,
      expires_at: newExpiry
    }).eq('user_key', tokenRow.user_key).eq('platform', 'etsy');

    // keep local copy in sync so the next refresh uses the most recent token
    tokenRow.access_token = newAccessToken;
    tokenRow.refresh_token = newRefreshToken;
    tokenRow.expires_at = newExpiry;

    return newAccessToken;
  }

  const fetchUser = (token) => fetch('https://openapi.etsy.com/v3/application/users/me', {
    headers: {
      'Authorization': `Bearer ${token}`,
      'x-api-key': ETSY_CLIENT_ID
    }
  });
  let meResp = await fetchUser(accessToken);
  if (meResp.status === 401) {
    const newToken = await refreshEtsyToken(tokenRow, supabase);
    if (!newToken) {
      const errText = await meResp.text();
      console.error('[Etsy Inventory] Token refresh failed (users/me), still 401:', errText);
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'etsy_token_invalid',
          message: `Etsy authentication for ${userKey} has expired or been revoked. Please reconnect Etsy for this retailer.`
        })
      };
    }
    accessToken = newToken;
    meResp = await fetchUser(accessToken);
  }
  if (!meResp.ok) {
    const errText = await meResp.text();
    console.error('[Etsy Inventory] Failed to fetch users/me:', meResp.status, errText);
    return { statusCode: 400, body: 'Could not fetch Etsy user profile' };
  }
  const meJson = await meResp.json();
  let userId = null;
  if (meJson && typeof meJson === 'object') {
    if (meJson.user_id) {
      userId = meJson.user_id;
    } else if (meJson.user && (meJson.user.user_id || meJson.user.id)) {
      userId = meJson.user.user_id || meJson.user.id;
    } else if (Array.isArray(meJson.results)) {
      const userEntry = meJson.results.find(r => r && (r.user_id || r.id));
      if (userEntry) {
        userId = userEntry.user_id || userEntry.id;
      }
    }
  }
  const userIdInt = Number(userId);
  if (!Number.isInteger(userIdInt)) {
    console.error('[Etsy Inventory] Could not determine numeric user_id from users/me response:', meJson);
    return { statusCode: 400, body: 'Could not determine Etsy user_id' };
  }

  const fetchShopLookup = (token) => fetch(`https://openapi.etsy.com/v3/application/users/${userIdInt}/shops`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'x-api-key': ETSY_CLIENT_ID
    }
  });
  let shopResp = await fetchShopLookup(accessToken);
  if (shopResp.status === 401) {
    const newToken = await refreshEtsyToken(tokenRow, supabase);
    if (!newToken) {
      const errText = await shopResp.text();
      console.error('[Etsy Inventory] Token refresh failed (users/{id}/shops), still 401:', errText);
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'etsy_token_invalid',
          message: `Etsy authentication for ${userKey} has expired or been revoked. Please reconnect Etsy for this retailer.`
        })
      };
    }
    accessToken = newToken;
    shopResp = await fetchShopLookup(accessToken);
  }
  if (!shopResp.ok) {
    const errText = await shopResp.text();
    console.error('[Etsy Inventory] Failed to fetch users/{user_id}/shops:', shopResp.status, errText);
    return { statusCode: 400, body: 'Could not fetch Etsy shop information' };
  }
  const shopJson = await shopResp.json();
  if (shopJson && typeof shopJson === 'object') {
    if (shopJson.shop_id) {
      shopId = shopJson.shop_id;
    } else if (Array.isArray(shopJson.results)) {
      const firstShop = shopJson.results.find(s => s && s.shop_id);
      if (firstShop) shopId = firstShop.shop_id;
    } else if (Array.isArray(shopJson.data)) {
      const firstShop = shopJson.data.find(s => s && s.shop_id);
      if (firstShop) shopId = firstShop.shop_id;
    } else if (Array.isArray(shopJson.shops)) {
      const firstShop = shopJson.shops.find(s => s && s.shop_id);
      if (firstShop) shopId = firstShop.shop_id;
    }
  }
  if (!shopId) {
    console.error('[Etsy Inventory] No shop_id found in users/{user_id}/shops response');
    return { statusCode: 400, body: 'No Etsy shop_id found in users/{user_id}/shops response' };
  }

  // Fetch all active listings for the shop in one call, then map quantities by SKU
  const results = {};
  for (const sku of skus) {
    results[sku] = null;
  }
  try {
    let listings = [];
    let offset = 0;
    const limit = 100; // Etsy API max is 100
    let total = null;
    do {
      const url = `https://openapi.etsy.com/v3/application/shops/${shopId}/listings/active?limit=${limit}&offset=${offset}`;
      const resp = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'x-api-key': ETSY_CLIENT_ID
        }
      });
      if (!resp.ok) {
        const errText = await resp.text();
        console.error('[Etsy Inventory] Failed to fetch active listings:', resp.status, errText);
        break;
      }
      const json = await resp.json();
      // Log the raw Etsy API response for this page
      if (Array.isArray(json.results)) {
        listings = listings.concat(json.results);
        // Log all SKUs from this page of results
        const allSkus = json.results.flatMap(l => Array.isArray(l.sku) ? l.sku : []).filter(Boolean);
      }
      if (typeof json.count === 'number') {
        total = json.count;
      }
      offset += limit;
    } while (total !== null && listings.length < total);
    const requestedSkuSet = new Set(skus.filter(s => typeof s === 'string' && s.trim() !== ''));
    const listingMatches = [];
    function extractListingSkus(listing) {
      if (!listing) return [];
      if (Array.isArray(listing.skus)) return listing.skus.filter(Boolean);
      if (Array.isArray(listing.sku)) return listing.sku.filter(Boolean);
      if (typeof listing.sku === 'string') return [listing.sku];
      return [];
    }
    for (const listing of listings) {
      if (!listing || !listing.listing_id) continue;
      const listingSkus = extractListingSkus(listing);
      if (!listingSkus.length) continue;
      const matchedSkus = listingSkus.filter(sku => requestedSkuSet.has(sku));
      if (matchedSkus.length) {
        listingMatches.push({
          listingId: listing.listing_id,
          skus: Array.from(new Set(matchedSkus))
        });
      }
    }
    const concurrencyLimit = 5;
    const inflight = [];
    async function fetchListingInventory(listingId, targetSkus) {
      try {
        const invResp = await fetch(`https://openapi.etsy.com/v3/application/listings/${listingId}/inventory`, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'x-api-key': ETSY_CLIENT_ID
          }
        });
        if (!invResp.ok) {
          const errText = await invResp.text();
          console.error(`[Etsy Inventory] Failed to GET inventory for listing ${listingId}:`, invResp.status, errText);
          return;
        }
        const invJson = await invResp.json();
        if (!Array.isArray(invJson.products)) return;
        for (const sku of targetSkus) {
          if (results[sku] !== null && results[sku] !== undefined) continue;
          const product = invJson.products.find(p => p && p.sku === sku);
          if (product && Array.isArray(product.offerings)) {
            const qty = product.offerings.reduce((sum, offering) => sum + (parseInt(offering.quantity) || 0), 0);
            results[sku] = qty;
          } else {
            results[sku] = null;
          }
        }
      } catch (err) {
        console.error(`[Etsy Inventory] Exception fetching inventory for listing ${listingId}:`, err);
      }
    }
    for (const match of listingMatches) {
      inflight.push(fetchListingInventory(match.listingId, match.skus));
      if (inflight.length >= concurrencyLimit) {
        await Promise.all(inflight);
        inflight.length = 0;
      }
    }
    if (inflight.length) {
      await Promise.all(inflight);
    }
  } catch (e) {
    console.error('[Etsy Inventory] Error fetching active listings:', e);
    for (const sku of skus) {
      results[sku] = '';
    }
  }
  return {
    statusCode: 200,
    body: JSON.stringify(results)
  };
};
