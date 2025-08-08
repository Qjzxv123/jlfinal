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
    // Log raw Faire API output for debugging
  } catch (jsonErr) {
    console.error(`[CRON] Failed to parse Faire API response as JSON for userKey ${userKey}:`, jsonErr);
    return;
  }
  let orders = [];
  for (const order of (data.orders || [])) {
    const shippingDetails = order.address || {};
    // Split bundle SKUs into separate items and combine with non-bundled SKUs by SKU only
    let itemMap = {};
    for (const item of (order.items || [])) {
      if (item.sku && item.sku.includes('GIFT-BOX')) {
        // If SKU contains GIFT-BOX, keep the whole SKU string as a single item
        const key = item.sku.trim();
        let itemQty = item.quantity || 0;
        if (item.includes_tester === true) {
          itemQty += 1;
        }
        if (!itemMap[key]) {
          itemMap[key] = {
            SKU: key,
            Name: item.product_name || '',
            Quantity: itemQty
          };
        } else {
          itemMap[key].Quantity += itemQty;
        }
      } else if (item.sku && item.sku.includes('+')) {
        // Bundle SKU, split and aggregate as before
        const skus = item.sku.split('+').map(s => s.trim());
        const uniqueSKUs = Array.from(new Set(skus));
        if (uniqueSKUs.length === 1) {
          const key = uniqueSKUs[0];
          let totalQty = skus.length;
          if (item.includes_tester === true) {
            totalQty += 1;
          }
          if (!itemMap[key]) {
            itemMap[key] = {
              SKU: key,
              Name: item.product_name || '',
              Quantity: totalQty
            };
          } else {
            itemMap[key].Quantity += totalQty;
          }
        } else {
          for (const key of skus) {
            if (!itemMap[key]) {
              itemMap[key] = {
                SKU: key,
                Name: item.product_name || '',
                Quantity: 1
              };
            } else {
              itemMap[key].Quantity += 1;
            }
          }
          if (item.includes_tester === true && skus.length > 0) {
            itemMap[skus[0]].Quantity += 1;
          }
        }
      } else {
        const key = item.sku || '';
        let itemQty = item.quantity || 0;
        if (item.includes_tester === true) {
          itemQty += 1;
        }
        if (!itemMap[key]) {
          itemMap[key] = {
            SKU: item.sku || '',
            Name: item.product_name || '',
            Quantity: itemQty
          };
        } else {
          itemMap[key].Quantity += itemQty;
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
  // Clear Orders table before inserting new ones
  await supabase.from('Orders').delete().neq('OrderID', '');
  // Fetch all userKeys from the oauth token table in Supabase
  const { data, error } = await supabase
    .from('oauth_tokens')
    .select('user_key')
    .neq('user_key', null)
    .eq('platform', 'faire');
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
