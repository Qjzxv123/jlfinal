// netlify/functions/shopify-get-orders-cron.cjs
// Scheduled function: Fetches orders from all Shopify stores and upserts to Orders table

const { createClient } = require('@supabase/supabase-js');
let fetch = require('node-fetch');
if (fetch && fetch.default) fetch = fetch.default;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

exports.handler = async function(event) {
  console.log('[Shopify Orders Cron] Starting scheduled order fetch');

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Fetch all Shopify tokens from oauth_tokens
  let tokenRows = [];
  try {
    const { data, error } = await supabase
      .from('oauth_tokens')
      .select('ShopifyDomain, user_key, access_token, UserID')
      .eq('platform', 'shopify');
    if (error) throw error;
    tokenRows = data || [];
  } catch (e) {
    console.error('[Shopify Orders Cron] Failed to fetch tokens:', e);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to fetch tokens', details: e.message })
    };
  }

  if (tokenRows.length === 0) {
    console.log('[Shopify Orders Cron] No Shopify tokens found');
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'No Shopify tokens to process' })
    };
  }

  // Fetch SKU Mapping table for converting SKUs
  const { data: skuMappings, error: mappingError } = await supabase
    .from('SkuMapping')
    .select('SKU, Output');

  if (mappingError) {
    console.warn('[Shopify Orders Cron] Error fetching SKU Mappings:', mappingError.message);
  }

  // Create a map for quick lookup: SKU -> Output object
  const skuMappingMap = {};
  if (skuMappings) {
    for (const mapping of skuMappings) {
      skuMappingMap[mapping.SKU] = mapping.Output;
    }
  }

  let totalOrdersProcessed = 0;

  for (const tokenRow of tokenRows) {
    const shopDomain = tokenRow.ShopifyDomain || tokenRow.user_key;
    const accessToken = tokenRow.access_token;
    const userID = tokenRow.UserID;

    if (!shopDomain || !accessToken) {
      console.warn('[Shopify Orders Cron] Missing domain or token for row:', tokenRow);
      continue;
    }

    console.log(`[Shopify Orders Cron] Processing shop: ${shopDomain}`);

    const baseUrl = `https://${shopDomain}`;
    let allOrders = [];
    let nextUrl = `${baseUrl}/admin/api/2023-10/orders.json?status=open&limit=250&fields=id,name,email,created_at,updated_at,currency,total_price,subtotal_price,financial_status,fulfillment_status,cancelled_at,closed_at,order_number,line_items,shipping_address,billing_address,tags,note,customer`;
    let safetyCounter = 0;

    try {
      // Fetch all open orders with pagination
      while (nextUrl && safetyCounter < 20) {
        safetyCounter += 1;
        const res = await fetch(nextUrl, {
          method: 'GET',
          headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json'
          }
        });

        if (!res.ok) {
          const errText = await res.text();
          console.error(`[Shopify Orders Cron] API error for ${shopDomain}:`, res.status, errText);
          break;
        }

        const data = await res.json();
        if (data && Array.isArray(data.orders)) {
          allOrders = allOrders.concat(data.orders);
        }

        // Parse Link header for pagination
        const linkHeader = res.headers.get('link') || res.headers.get('Link');
        if (linkHeader && linkHeader.includes('rel="next"')) {
          const match = linkHeader.split(',').find(part => part.includes('rel="next"'));
          if (match) {
            const urlMatch = match.match(/<([^>]+)>/);
            if (urlMatch && urlMatch[1]) {
              nextUrl = urlMatch[1];
            } else {
              nextUrl = null;
            }
          } else {
            nextUrl = null;
          }
        } else {
          nextUrl = null;
        }
      }

      console.log(`[Shopify Orders Cron] Fetched ${allOrders.length} orders for ${shopDomain}`);

      // Transform Shopify orders to our Orders table format
      const ordersToUpsert = [];

      for (const order of allOrders) {
        // Build items array from line_items
        let itemMap = {};

        if (Array.isArray(order.line_items)) {
          for (const lineItem of order.line_items) {
            const sku = lineItem.sku || '';
            const qty = lineItem.quantity || 0;
            const name = lineItem.name || lineItem.title || '';

            if (!sku) continue;

            // Handle bundle SKUs (contains '+')
            if (sku.includes('+')) {
              const skus = sku.split('+').map(s => s.trim());
              const uniqueSKUs = Array.from(new Set(skus));

              if (uniqueSKUs.length === 1) {
                // All components are the same SKU
                const key = uniqueSKUs[0];
                const totalQty = skus.length * qty;
                if (!itemMap[key]) {
                  itemMap[key] = { SKU: key, Name: name, Quantity: totalQty };
                } else {
                  itemMap[key].Quantity += totalQty;
                }
              } else {
                // Mixed bundle - attribute full ordered quantity to each component
                for (const componentSku of skus) {
                  if (!itemMap[componentSku]) {
                    itemMap[componentSku] = { SKU: componentSku, Name: name, Quantity: qty };
                  } else {
                    itemMap[componentSku].Quantity += qty;
                  }
                }
              }
            } else {
              // Normal single SKU
              if (!itemMap[sku]) {
                itemMap[sku] = { SKU: sku, Name: name, Quantity: qty };
              } else {
                itemMap[sku].Quantity += qty;
              }
            }
          }
        }

        let parsedItems = Object.values(itemMap);

        // Apply SKU Mapping transformations
        let transformedItems = [];
        for (const item of parsedItems) {
          if (skuMappingMap[item.SKU]) {
            const outputMap = skuMappingMap[item.SKU];
            for (const [outputSku, outputQty] of Object.entries(outputMap)) {
              const totalQty = (outputQty || 1) * (item.Quantity || 1);
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
            transformedItems.push(item);
          }
        }

        const orderID = String(order.id);

        // Check if order exists to preserve Notes, CustomerMessages, Retailer, and InventoryRemoved
        const { data: existingOrder } = await supabase
          .from('Orders')
          .select('Notes, CustomerMessages, InventoryRemoved, Retailer')
          .eq('OrderID', orderID)
          .single();

        const shippingAddress = order.shipping_address || {};
        const orderData = {
          OrderID: orderID,
          Retailer: existingOrder?.Retailer || tokenRow.user_key,
          Items: JSON.stringify(transformedItems),
          Customer: JSON.stringify({
            name: shippingAddress.name || order.customer?.first_name + ' ' + order.customer?.last_name || '',
            address1: shippingAddress.address1 || '',
            address2: shippingAddress.address2 || '',
            city: shippingAddress.city || '',
            state: shippingAddress.province || '',
            zipCode: shippingAddress.zip || '',
            country: shippingAddress.country || ''
          }),
          Platform: 'Shopify',
          Link: `https://${shopDomain}/admin/orders/${order.id}`,
          Notes: existingOrder?.Notes || null,
          CustomerMessages: existingOrder?.CustomerMessages || null,
          InventoryRemoved: existingOrder?.InventoryRemoved || null,
          UserID: userID ? [userID] : null
        };

        ordersToUpsert.push(orderData);
      }

      // Upsert orders to Supabase
      if (ordersToUpsert.length > 0) {
        const { error: upsertError } = await supabase
          .from('Orders')
          .upsert(ordersToUpsert, { onConflict: ['OrderID'] });

        if (upsertError) {
          console.error(`[Shopify Orders Cron] Failed to upsert orders for ${shopDomain}:`, upsertError);
        } else {
          console.log(`[Shopify Orders Cron] Upserted ${ordersToUpsert.length} orders for ${shopDomain}`);
          totalOrdersProcessed += ordersToUpsert.length;
        }
      }

    } catch (err) {
      console.error(`[Shopify Orders Cron] Unexpected error for ${shopDomain}:`, err);
    }
  }

  console.log(`[Shopify Orders Cron] Completed. Total orders processed: ${totalOrdersProcessed}`);

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: `Processed ${tokenRows.length} shops, ${totalOrdersProcessed} orders total`
    })
  };
};
