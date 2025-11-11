// netlify/functions/shippo-get-orders-cron.cjs
// Netlify scheduled function: Fetch Shippo orders every hour and save to Supabase

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
exports.handler = async (event) => {
  // Clear Orders table before inserting new ones
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  await supabase.from('Orders').delete().neq('Platform', 'Faire').eq("Notes", null).eq("CustomerMessages", null).eq("InventoryRemoved", null);
  console.log('[Shippo Cron] Function invoked');

  const SHIPPO_API_KEY = process.env.SHIPPO_API_KEY;
  if (!SHIPPO_API_KEY) {
    console.log('[Shippo Cron] Missing Shippo API token');
    return { statusCode: 500, body: 'Missing Shippo API token.' };
  }

  // Fetch Shippo orders (transactions) after 8/01/2025, handle pagination
  let orders = [];
  try {
    const createdAfter = '2025-08-01T00:00:00Z';
    let page = 1;
    let keepGoing = true;
    while (keepGoing) {
      const url = `https://api.goshippo.com/orders?order_status[]=PAID&results=100&page=${page}&start_date=${encodeURIComponent(createdAfter)}`;
      const resp = await fetch(url, {
        headers: { Authorization: `ShippoToken ${SHIPPO_API_KEY}` }
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.detail || 'Failed to fetch Shippo orders');
      const pageResults = data.results || [];
      orders = orders.concat(pageResults);
      if (pageResults.length < 100) {
        keepGoing = false;
      } else {
        page++;
      }
    }
  } catch (err) {
    return { statusCode: 500, body: 'Error fetching Shippo orders: ' + err.message };
  }
  console.log(`[CRON] Fetched ${orders.length} Shippo orders`);
  // Save orders to Supabase
  let processedCount = 0;
  let skippedCount = 0;
  
  try {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    
    // Get all existing OrderIDs and Retailers from Order History to avoid duplicates
    const { data: historyOrders, error: historyError } = await supabase
      .from('Order History')
      .select('OrderID, Retailer');
    
    if (historyError) {
      console.warn('[Shippo Cron] Error fetching Order History:', historyError.message);
    }
    
    // Fetch SKU Mapping table for converting SKUs
    const { data: skuMappings, error: mappingError } = await supabase
      .from('SkuMapping')
      .select('SKU, Output');
    
    if (mappingError) {
      console.warn('[Shippo Cron] Error fetching SKU Mappings:', mappingError.message);
    }
    
    // Create a map for quick lookup: SKU -> Output object
    const skuMappingMap = {};
    if (skuMappings) {
      for (const mapping of skuMappings) {
        skuMappingMap[mapping.SKU] = mapping.Output;
      }
    }
    
    // Create a Set of "OrderID|Retailer" combinations for efficient lookup
    const historyOrderKeys = new Set((historyOrders || []).map(h => `${h.OrderID}|${h.Retailer}`));
    console.log(`[Shippo Cron] Found ${historyOrderKeys.size} order+retailer combinations in history to skip`);
    
    for (const order of orders) {
      const orderID = order.order_number.replace("#","");
      
      // Get first SKU from line_items
      let retailerValue = "Unknown";
      if (order.line_items && order.line_items.length > 0) {
        let firstSku = order.line_items[0].sku;
        if (firstSku && typeof firstSku === 'string') {
          // If SKU contains '+', only use the first part
          firstSku = firstSku.split('+')[0].trim();
          // Query Product table for retailer value
          const { data: product, error } = await supabase
            .from('Products')
            .select('Retailer')
            .eq('ProductSKU', firstSku)
            .single();
          if (!error && product && product.Retailer) {
            retailerValue = product.Retailer;
          }
        }
      }
      
      // If retailer is still unknown, check if "Hotana" appears anywhere in the order
      if (retailerValue === "Unknown") {
        const orderText = JSON.stringify(order).toLowerCase();
        if (orderText.includes('hotana')||orderText.includes('batana')) {
          retailerValue = "Hotana";
        }
      }
      
      // Skip if order already exists in Order History with same OrderID AND Retailer
      const orderKey = `${orderID}|${retailerValue}`;
      if (historyOrderKeys.has(orderKey)) {
        skippedCount++;
        continue;
      }
      // Build customer object with required fields
      let customerObj = null;
      if (order.to_address) {
        customerObj = {
          name: order.to_address.name || '',
          address1: order.to_address.street1 || '',
          address2: order.to_address.street2 || '',
          city: order.to_address.city || '',
          state: order.to_address.state || '',
          zipCode: order.to_address.zip || '',
          country: order.to_address.country || ''
        };
      }
      
      // Process line items with SKU separation logic (same as Faire)
      let itemMap = {};
      for (const item of (order.line_items || [])) {
        if (item.sku && item.sku.includes('GIFT-BOX')) {
          // If SKU contains GIFT-BOX, keep the whole SKU string as a single item
          const key = item.sku.trim();
          let itemQty = item.quantity || 0;
          if (!itemMap[key]) {
            itemMap[key] = {
              SKU: key,
              Name: item.title || '',
              Quantity: itemQty
            };
          } else {
            itemMap[key].Quantity += itemQty;
          }
        } else if (item.sku && item.sku.includes('+')) {
          // Bundle SKU, split and aggregate
          const skus = item.sku.split('+').map(s => s.trim());
          const uniqueSKUs = Array.from(new Set(skus));
          if (uniqueSKUs.length === 1) {
            const key = uniqueSKUs[0];
            let totalQty = skus.length * (item.quantity || 0);
            if (!itemMap[key]) {
              itemMap[key] = {
                SKU: key,
                Name: item.title || '',
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
                  Name: item.title || '',
                  Quantity: item.quantity || 0
                };
              } else {
                itemMap[key].Quantity += (item.quantity || 0);
              }
            }
          }
        } else {
          const key = item.sku || '';
          let itemQty = item.quantity || 0;
          if (!itemMap[key]) {
            itemMap[key] = {
              SKU: item.sku || '',
              Name: item.title || '',
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
                Name: item.Name, // Keep original name or could look up from Products table
                Quantity: totalQty
              });
            }
          }
        } else {
          // No mapping, keep as-is
          transformedItems.push(item);
        }
      }
      
      // Check if order exists to preserve Notes, CustomerMessages, and InventoryRemoved
      const { data: existingOrder } = await supabase
        .from('Orders')
        .select('Notes, CustomerMessages, InventoryRemoved, Retailer')
        .eq('OrderID', orderID)
        .single();
      
      await supabase.from('Orders').upsert({
        OrderID: orderID,
        Retailer: existingOrder?.Retailer || retailerValue,
        Items: JSON.stringify(transformedItems),
        Customer: customerObj ? JSON.stringify(customerObj) : null,
        Platform: order.shop_app,
        Link: getPlatformOrderUrl(order.shop_app, order.order_number, retailerValue),
        Notes: existingOrder?.Notes || order.notes || null,
        CustomerMessages: existingOrder?.CustomerMessages || null,
        InventoryRemoved: existingOrder?.InventoryRemoved || null,
        ShippoOrderID: order.object_id || null,
      }, { onConflict: 'OrderID' });
      
      processedCount++;
    }
    
    console.log(`[Shippo Cron] Processed ${processedCount} orders, skipped ${skippedCount} (already in history)`);
  } catch (e) {
    return { statusCode: 500, body: 'Error saving Shippo orders to Supabase: ' + e.message };
  }

  return { statusCode: 200, body: `Fetched ${orders.length} Shippo orders, processed ${processedCount || orders.length}, skipped ${skippedCount || 0} (already in history).` };
};

function getPlatformOrderUrl(platform, orderNumber, retailerValue) {
  switch(platform?.toLowerCase()) {
    case 'etsy':
      return `https://www.etsy.com/your/orders/sold?ref=seller-platform-mcnav&order_id=${orderNumber}`;
    case 'shopify': {
      let domain = 'river-organics-skincare';
      if (retailerValue && retailerValue.toLowerCase().includes('j&l')) {
        domain = 'j-l-naturals';
      }
      return `https://admin.shopify.com/store/${domain}/orders?query=${orderNumber.replace("#","")}`;
    }
    case 'amazon':
      return `https://sellercentral.amazon.com/orders-v3/order/${orderNumber}`;
    case 'tiktok':
      return `http://seller-us.tiktok.com/order/detail?order_no=${orderNumber}`;
    default:
      return '#';
  }
}
