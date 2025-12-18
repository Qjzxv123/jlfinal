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

  // Try to fetch shop_id, refresh token if 401
  let meResp = await fetch('https://openapi.etsy.com/v3/application/users/me', {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'x-api-key': ETSY_CLIENT_ID
    }
  });
  if (meResp.status === 401) {
    // Try refresh
    const newToken = await refreshEtsyToken(tokenRow, supabase);
    if (!newToken) {
      const errText = await meResp.text();
      console.error('[Etsy Inventory] Token refresh failed, still 401:', errText);
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
    meResp = await fetch('https://openapi.etsy.com/v3/application/users/me', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'x-api-key': ETSY_CLIENT_ID
      }
    });
  }
  if (!meResp.ok) {
    const errText = await meResp.text();
    console.error('[Etsy Inventory] Failed to fetch user/me:', meResp.status, errText);
    return { statusCode: 400, body: 'Could not fetch Etsy user/me' };
  }
  const meJson = await meResp.json();
  if (meJson && meJson.shop_id) {
    shopId = meJson.shop_id;
  } else {
    console.error('[Etsy Inventory] No shop_id found in getMe response');
    return { statusCode: 400, body: 'No Etsy shop_id found in getMe response' };
  }

  // Fetch all active listings for the shop in one call, then map quantities by SKU
  const results = {};
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
    // Map full listing object by SKU for requested SKUs (like Faire)
    // Etsy listings may use 'skus' (array) or 'sku' (string/array). Flatten all SKUs for matching.
    for (const sku of skus) {
      let match = null;
      for (const l of listings) {
        // Prefer 'skus' property if present, else fallback to 'sku'
        let allSkus = [];
        if (Array.isArray(l.skus)) {
          allSkus = l.skus;
        } else if (Array.isArray(l.sku)) {
          allSkus = l.sku;
        } else if (typeof l.sku === 'string') {
          allSkus = [l.sku];
        }
        if (allSkus.includes(sku)) {
          match = l;
          break;
        }
      }
      if (match && match.listing_id) {
        // Fetch inventory for this listing
        try {
          const invResp = await fetch(`https://openapi.etsy.com/v3/application/listings/${match.listing_id}/inventory`, {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'x-api-key': ETSY_CLIENT_ID
            }
          });
          if (invResp.ok) {
            const invJson = await invResp.json();
            let foundQty = null;
            if (Array.isArray(invJson.products)) {
              for (const p of invJson.products) {
                if (p.sku === sku) {
                  // Sum all offering quantities for this SKU
                  if (Array.isArray(p.offerings)) {
                    foundQty = p.offerings.reduce((sum, o) => sum + (parseInt(o.quantity) || 0), 0);
                  }
                  break;
                }
              }
            }
            results[sku] = foundQty;
          } else {
            results[sku] = null;
          }
        } catch (e) {
          results[sku] = null;
        }
      } else {
        results[sku] = null;
      }
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
