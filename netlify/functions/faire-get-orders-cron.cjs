// Suppress Node.js deprecation warnings (e.g., punycode)
process.on('warning', (warning) => {
  if (warning.name === 'DeprecationWarning' && warning.message.includes('punycode')) {
    // Ignore punycode deprecation warnings
    return;
  }
  // Optionally log other warnings
  // console.warn(warning);
});
// netlify/functions/faire-get-orders-cron.cjs
// Scheduled function: Fetches orders for all userKeys every hour

const { createClient } = require('@supabase/supabase-js');
const { getValidToken } = require('./faire-token-utils.cjs');
let fetchFn;
if (typeof fetch !== 'undefined') {
  fetchFn = fetch;
} else {
  fetchFn = require('node-fetch');
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function fetchOrdersForUser(userKey) {
  // Fetch the token row to get UserID
  let apiToken, tokenRow;
  try {
    const { getTokenRow } = require('./faire-token-utils.cjs');
    tokenRow = await getTokenRow(userKey);
    apiToken = tokenRow.access_token;
  } catch (tokenErr) {
    console.error(`[CRON] Token error for userKey ${userKey}:`, tokenErr.message);
    return;
  }
  const credentials = Buffer.from(`${process.env.FAIRE_CLIENT_ID}:${process.env.FAIRE_CLIENT_SECRET}`).toString('base64');
  const url = 'https://www.faire.com/external-api/v2/orders?limit=50&excluded_states=DELIVERED,BACKORDERED,CANCELED,NEW,PRE_TRANSIT,IN_TRANSIT';
  let response;
  try {
    response = await fetchFn(url, {
      headers: {
        'X-FAIRE-APP-CREDENTIALS': credentials,
        'X-FAIRE-OAUTH-ACCESS-TOKEN': apiToken,
        'Content-Type': 'application/json'
      }
    });
  } catch (fetchErr) {
    console.error(`[CRON] Fetch to Faire API failed for userKey ${userKey}:`, fetchErr);
    return;
  }
  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[CRON] Faire API error for userKey ${userKey}:`, response.status, errorText);
    return;
  }
  let data;
  try {
    data = await response.json();
  } catch (jsonErr) {
    console.error(`[CRON] Failed to parse Faire API response as JSON for userKey ${userKey}:`, jsonErr);
    return;
  }
  let orders = [];
  for (const order of (data.orders || [])) {
    const shippingDetails = order.address || {};
    const orderData = {
      OrderId: order.id || '',
      Items: (order.items || []).map(item => ({
        SKU: item.sku || '',
        Name: item.product_name || '',
        Quantity: item.quantity || 0
      })),
      ShipTo_Name: shippingDetails.name || '',
      ShipTo_Address1: shippingDetails.address1 || '',
      ShipTo_Address2: shippingDetails.address2 || '',
      ShipTo_City: shippingDetails.city || '',
      ShipTo_State: shippingDetails.state || '',
      ShipTo_ZipCode: shippingDetails.postal_code || '',
      ShipTo_Country: shippingDetails.country || '',
      Platform: 'Faire',
      Link: `https://www.faire.com/brand-portal/orders/${order.id}/order-fulfilment?sync=true&type=UNFULFILLED`,
      UserID: tokenRow.UserID || null, // Add UserID from token row
      Retailer: tokenRow.email
    };
    orders.push(orderData);
  }
  console.log(`[CRON] UserKey ${userKey}: Added ${orders.length} orders`);
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
    .neq('user_key', null);
  if (error) {
    console.error('[CRON] Failed to fetch userKeys:', error);
    return { statusCode: 500, body: 'Failed to fetch userKeys' };
  }
  const userKeys = (data || []).map(row => row.user_key);
  for (const userKey of userKeys) {
    await fetchOrdersForUser(userKey);
  }
  return { statusCode: 200, body: `Processed ${userKeys.length} userKeys` };
};
