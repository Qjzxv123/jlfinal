// netlify/functions/faire-get-orders-cron.cjs
// Scheduled function: Fetches orders for all userKeys every hour
const { createClient } = require('@supabase/supabase-js');
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
    // Split bundle SKUs into separate items and deduplicate by SKU+Name
    let itemMap = {};
    for (const item of (order.items || [])) {
      if (item.sku && item.sku.includes('+')) {
        // Bundle SKU, split and create separate items
        const skus = item.sku.split('+');
        for (const sku of skus) {
          const key = `${sku.trim()}|${item.product_name || ''}`;
          if (!itemMap[key]) {
            itemMap[key] = {
              SKU: sku.trim(),
              Name: item.product_name || '',
              Quantity: item.quantity || 0
            };
          } else {
            itemMap[key].Quantity += item.quantity || 0;
          }
        }
      } else {
        const key = `${item.sku || ''}|${item.product_name || ''}`;
        if (!itemMap[key]) {
          itemMap[key] = {
            SKU: item.sku || '',
            Name: item.product_name || '',
            Quantity: item.quantity || 0
          };
        } else {
          itemMap[key].Quantity += item.quantity || 0;
        }
      }
    }
    let parsedItems = Object.values(itemMap);
    const orderData = {
      OrderID: order.id || '',
      Retailer: userKey,
      Items: JSON.stringify(parsedItems),
      Customer: JSON.stringify({
        name: shippingDetails.name || '',
        address1: shippingDetails.address1 || '',
        address2: shippingDetails.address2 || '',
        city: shippingDetails.city || '',
        state: shippingDetails.state || '',
        zipCode: shippingDetails.postal_code || '',
        country: shippingDetails.country || ''
      }),
      Platform: 'Faire',
      Link: `https://www.faire.com/brand-portal/orders/${order.id}/order-fulfilment?sync=true&type=UNFULFILLED`,
      Notes: null,
      UserID: tokenRow.UserID ? [tokenRow.UserID] : null
    };
    orders.push(orderData);
  }
    // Save orders to Supabase Orders table
  if (orders.length > 0) {
    const { error: insertError } = await supabase
      .from('Orders')
      .upsert(orders, { onConflict: ['OrderID'] });
    if (insertError) {
      console.error(`[CRON] Failed to insert orders for userKey ${userKey}:`, insertError);
    } else {
      console.log(`[CRON] Inserted/updated ${orders.length} orders for userKey ${userKey}`);
    }
  }
}

exports.handler = async function(event) {
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
  return {
    statusCode: 200,
    body: JSON.stringify({ message: `Processed ${userKeys.length} userKeys` })
  };
};
