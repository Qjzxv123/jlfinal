// netlify/functions/faire-refresh-orders.cjs
// Manual refresh function: Fetches Faire orders and saves them to Supabase (can be invoked directly or via cron)

const { createClient } = require('@supabase/supabase-js');
let fetchFn;
if (typeof fetch !== 'undefined') {
  fetchFn = fetch;
} else {
  fetchFn = require('node-fetch');
}
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function fetchOrdersForUser(userKey, skuMappingMap) {
  // Fetch the token row to get UserID
  let apiToken, tokenRow;
  try {
    const { getTokenRow } = require('./faire-token-utils.cjs');
    tokenRow = await getTokenRow(userKey);
    apiToken = tokenRow.access_token;
  } catch (tokenErr) {
    console.error(`[Faire Refresh] Token error for userKey ${userKey}:`, tokenErr.message);
    return 0;
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
    console.error(`[Faire Refresh] Fetch to Faire API failed for userKey ${userKey}:`, fetchErr);
    return 0;
  }
  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Faire Refresh] Faire API error for userKey ${userKey}:`, response.status, errorText);
    return 0;
  }
  let data;
  try {
    data = await response.json();
  } catch (jsonErr) {
    console.error(`[Faire Refresh] Failed to parse Faire API response as JSON for userKey ${userKey}:`, jsonErr);
    return 0;
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
          // Multiply number of components in the bundle by the line item's ordered quantity
          let totalQty = skus.length * (item.quantity || 0);
          if (item.includes_tester === true) {
            totalQty += 1; // Treat tester as one extra unit of the first (only) SKU
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
          // For mixed bundles, attribute the full ordered quantity to each component SKU
          const addQty = (item.quantity || 0);
          for (const key of skus) {
            if (!itemMap[key]) {
              itemMap[key] = {
                SKU: key,
                Name: item.product_name || '',
                Quantity: addQty
              };
            } else {
              itemMap[key].Quantity += addQty;
            }
          }
          if (item.includes_tester === true && skus.length > 0) {
            // Assign tester to first component SKU
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
    
    // Apply SKU Mapping transformations
    let transformedItems = [];
    for (const item of parsedItems) {
      if (skuMappingMap[item.SKU]) {
        // This SKU has a mapping - expand it to output SKUs
        const outputMap = skuMappingMap[item.SKU];
        for (const [outputSku, outputQty] of Object.entries(outputMap)) {
          // Multiply the output quantity by the item quantity
          const totalQty = (outputQty || 1) * (item.Quantity || 1);
          // Check if this output SKU already exists in transformedItems
          const existing = transformedItems.find(t => t.SKU === outputSku);
          if (existing) {
            existing.Quantity += totalQty;
          } else {
            transformedItems.push({
              SKU: outputSku,
              Name: item.Name,
              Quantity: totalQty
            });
          }
        }
      } else {
        // No mapping, keep as-is
        transformedItems.push(item);
      }
    }
    
    const orderID = order.id || '';
    
    // Check if order exists to preserve Notes, CustomerMessages, Retailer and InventoryRemoved
    const { data: existingOrder } = await supabase
      .from('Orders')
      .select('Notes, CustomerMessages, InventoryRemoved, Retailer')
      .eq('OrderID', orderID)
      .single();
    
    // Extract price from payout_costs
    const subtotalCents = order?.payout_costs?.subtotal_after_brand_discounts?.amount_minor;
    const price = (subtotalCents != null && Number.isFinite(subtotalCents)) 
      ? Number((subtotalCents / 100).toFixed(2)) 
      : null;
    
    const orderData = {
      OrderID: orderID,
      Retailer: existingOrder?.Retailer || userKey,
      Items: JSON.stringify(transformedItems),
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
      Notes: existingOrder?.Notes || null,
      CustomerMessages: existingOrder?.CustomerMessages || null,
      InventoryRemoved: existingOrder?.InventoryRemoved || null,
      UserID: tokenRow.UserID ? [tokenRow.UserID] : null,
      Price: price
    };
    orders.push(orderData);
  }
  // Save orders to Supabase Orders table
  if (orders.length > 0) {
    const { error: insertError } = await supabase
      .from('Orders')
      .upsert(orders, { onConflict: ['OrderID'] });
    if (insertError) {
      console.error(`[Faire Refresh] Failed to insert orders for userKey ${userKey}:`, insertError);
      return 0;
    }
    console.log(`[Faire Refresh] Inserted/updated ${orders.length} orders for userKey ${userKey}`);
    return orders.length;
  }
  return 0;
}

async function refreshFaireOrders(event) {
  // Clear Orders table before inserting new ones
  await supabase.from('Orders').delete().eq('Platform', 'Faire').eq("Notes", null).eq("CustomerMessages", null).eq("InventoryRemoved", null);
  
  // Fetch SKU Mapping table for converting SKUs
  const { data: skuMappings, error: mappingError } = await supabase
    .from('SkuMapping')
    .select('SKU, Output');
  
  if (mappingError) {
    console.warn('[Faire Refresh] Error fetching SKU Mappings:', mappingError.message);
  }
  
  // Create a map for quick lookup: SKU -> Output object
  const skuMappingMap = {};
  if (skuMappings) {
    for (const mapping of skuMappings) {
      skuMappingMap[mapping.SKU] = mapping.Output;
    }
  }
  
  // Fetch all userKeys from the oauth token table in Supabase
  const { data, error } = await supabase
    .from('oauth_tokens')
    .select('user_key')
    .neq('user_key', null)
    .eq('platform', 'faire');
  if (error) {
    console.error('[Faire Refresh] Failed to fetch userKeys:', error);
    return { statusCode: 500, body: 'Failed to fetch userKeys' };
  }
  const userKeys = (data || []).map(row => row.user_key);
  let totalOrders = 0;
  for (const userKey of userKeys) {
    totalOrders += await fetchOrdersForUser(userKey, skuMappingMap);
  }
  return {
    statusCode: 200,
    body: JSON.stringify({ message: `Processed ${userKeys.length} userKeys`, orders: totalOrders })
  };
}

exports.handler = refreshFaireOrders;
exports.refreshFaireOrders = refreshFaireOrders;
