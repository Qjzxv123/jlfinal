// netlify/functions/shippo-get-orders-cron.cjs
// Netlify scheduled function: Fetch Shippo orders every hour and save to Supabase

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
exports.handler = async (event) => {
  console.log('[Shippo Cron] Function invoked');

  const SHIPPO_API_KEY = process.env.SHIPPO_API_KEY;
  if (!SHIPPO_API_KEY) {
    console.log('[Shippo Cron] Missing Shippo API token');
    return { statusCode: 500, body: 'Missing Shippo API token.' };
  }

  // Fetch Shippo orders (transactions) after 7/25/2025
  let orders = [];
  try {
    // Shippo expects ISO 8601 format for date filtering
    const createdAfter = '2025-07-25T00:00:00Z';
    const url = `https://api.goshippo.com/orders?order_status[]=PAID&created__gt=${encodeURIComponent(createdAfter)}`;
    const resp = await fetch(url, {
      headers: { Authorization: `ShippoToken ${SHIPPO_API_KEY}` }
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.detail || 'Failed to fetch Shippo orders');
    orders = data.results || [];
  } catch (err) {
    return { statusCode: 500, body: 'Error fetching Shippo orders: ' + err.message };
  }
console.log(`[CRON] Fetched ${orders.length} Shippo orders`);
  // Save orders to Supabase
  try {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    for (const order of orders) {
      // Get first SKU from line_items
      let retailerValue = "JNL";
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
      
      // Determine platform - check for TikTok anywhere in the order data
      let platformValue = order.shop_app;
      const orderDataString = JSON.stringify(order).toLowerCase();
      if (orderDataString.includes('tiktok')) {
        platformValue = 'Shopify(TikTok)';
      }
      
      await supabase.from('Orders').upsert({
        OrderID: order.order_number.replace("#",""),
        Retailer: retailerValue,
        Items: order.line_items || null,
        Customer: customerObj ? JSON.stringify(customerObj) : null,
        Platform: platformValue,
        Link: getPlatformOrderUrl(platformValue, order.order_number, order.shopify_id, retailerValue),
        Notes: order.notes || null,
        ShippoObjectID: order.object_id || null,
        ShippoAddressID: order.to_address.object_id || null
      }, { onConflict: ['OrderID'] });
    }
  } catch (e) {
    return { statusCode: 500, body: 'Error saving Shippo orders to Supabase: ' + e.message };
  }

  return { statusCode: 200, body: `Fetched and saved ${orders.length} Shippo orders.` };
};

function getPlatformOrderUrl(platform, orderNumber) {
  switch(platform?.toLowerCase()) {
    case 'etsy':
      return `https://www.etsy.com/your/orders/sold?ref=seller-platform-mcnav&order_id=${orderNumber}`;
    case 'shopify': {
      return `N/A`;
    }
    default:
      return '#';
  }
}
