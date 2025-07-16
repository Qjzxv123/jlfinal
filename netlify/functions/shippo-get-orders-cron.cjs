// netlify/functions/shippo-get-orders-cron.cjs
// Netlify scheduled function: Fetch Shippo orders every hour and save to Supabase

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
exports.handler = async (event) => {
  // Only allow Netlify scheduled invocations
  if (event.headers['x-netlify-scheduled-event'] !== 'true') {
    return { statusCode: 403, body: 'Forbidden: Not a scheduled event.' };
  }

  const SHIPPO_API_KEY = process.env.SHIPPO_API_KEY;
  if (!SHIPPO_API_KEY) {
    return { statusCode: 500, body: 'Missing Shippo API token.' };
  }

  // Fetch Shippo orders (transactions)
  let orders = [];
  try {
    const resp = await fetch('https://api.goshippo.com/orders?order_status[]=PAID&order_status[]=UNKNOWN', {
      headers: { Authorization: `ShippoToken ${SHIPPO_API_KEY}` }
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.detail || 'Failed to fetch Shippo orders');
    orders = data.results || [];
  } catch (err) {
    return { statusCode: 500, body: 'Error fetching Shippo orders: ' + err.message };
  }
console.log(`[CRON] Fetched ${orders.length} Shippo orders`);
console.log('[DEBUG][Shippo] Orders:', orders);
  // Save orders to Supabase
  try {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    for (const order of orders) {
      // Get first SKU from line_items
      let retailerValue = "JNL";
      if (order.line_items && order.line_items.length > 0) {
        const firstSku = order.line_items[0].sku;
        if (firstSku) {
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
      await supabase.from('Orders').upsert({
        OrderID: order.order_number,
        Retailer: retailerValue,
        Items: order.line_items || null,
        Customer: order.to_address || null,
        Platform: order.shop_app,
        Link: getPlatformOrderUrl(order.shop_app, order.order_number, order.shopify_id, retailerValue),
        Status: order.status || 'Unfullfilled',
        Notes: order.notes || null,
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
