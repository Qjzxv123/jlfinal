// netlify/functions/etsy-get-orders-cron.cjs
// Scheduled function: Fetches orders for all Etsy userKeys every hour

const { createClient } = require('@supabase/supabase-js');
let fetchFn;
if (typeof fetch !== 'undefined') {
  fetchFn = fetch;
} else {
  fetchFn = require('node-fetch');
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function fetchOrdersForUser(userKey) {
  // Fetch the token row to get Etsy access token and UserID
  let tokenRow;
  try {
    const { data, error } = await supabase
      .from('oauth_tokens')
      .select('*')
      .eq('user_key', userKey)
      .eq('platform', 'etsy')
      .single();
    if (error || !data) throw new Error('No token found for user');
    tokenRow = data;
  } catch (tokenErr) {
    console.error(`[CRON][Etsy] Token error for userKey ${userKey}:`, tokenErr.message);
    return;
  }
  const accessToken = tokenRow.access_token;
  const userId = tokenRow.UserID || null;

  // Etsy API: Get Shop ID for the user
  let shopId;
  try {
    const shopResp = await fetchFn('https://openapi.etsy.com/v3/application/users/me/shops', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    if (!shopResp.ok) throw new Error('Failed to fetch shop info');
    const shopData = await shopResp.json();
    shopId = shopData.results && shopData.results[0] && shopData.results[0].shop_id;
    if (!shopId) throw new Error('No shop_id found for user');
  } catch (err) {
    console.error(`[CRON][Etsy] Failed to get shop_id for userKey ${userKey}:`, err.message);
    return;
  }

  // Etsy API: Get Orders for the shop
  let ordersResp, ordersData;
  try {
    ordersResp = await fetchFn(`https://openapi.etsy.com/v3/application/shops/${shopId}/receipts?limit=50`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    if (!ordersResp.ok) {
      const errorText = await ordersResp.text();
      throw new Error(`Etsy API error: ${ordersResp.status} ${errorText}`);
    }
    ordersData = await ordersResp.json();
  } catch (err) {
    console.error(`[CRON][Etsy] Failed to fetch orders for shop_id ${shopId}:`, err.message);
    return;
  }

  let orders = [];
  for (const order of (ordersData.results || [])) {
    const orderData = {
      ReceiptId: order.receipt_id || '',
      BuyerName: order.name || '',
      BuyerEmail: order.buyer_email || '',
      TotalPrice: order.total_price || 0,
      Currency: order.currency_code || '',
      CreatedAt: order.create_date || '',
      UserID: userId
    };
    orders.push(orderData);
  }
  console.log(`[CRON][Etsy] UserKey ${userKey}: Added ${orders.length} orders`);
  // Optionally: Save orders to Supabase here
}

exports.handler = async function(event, context) {
  // Only allow scheduled invocations
  if (!event.headers['x-netlify-scheduled-event']) {
    return { statusCode: 403, body: 'Forbidden' };
  }
  // Fetch all userKeys from the oauth token table in Supabase
  const { data, error } = await supabase
    .from('oauth_tokens')
    .select('user_key')
    .eq('platform', 'etsy')
    .neq('user_key', null);
  if (error) {
    console.error('[CRON][Etsy] Failed to fetch userKeys:', error);
    return { statusCode: 500, body: 'Failed to fetch userKeys' };
  }
  const userKeys = (data || []).map(row => row.user_key);
  for (const userKey of userKeys) {
    await fetchOrdersForUser(userKey);
  }
  return { statusCode: 200, body: `Processed ${userKeys.length} userKeys` };
};
