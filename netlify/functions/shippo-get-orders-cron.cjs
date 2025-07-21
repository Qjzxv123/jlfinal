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

  // Fetch Shippo orders (transactions)
  let orders = [];
  try {
    const resp = await fetch('https://api.goshippo.com/orders?order_status[]=PAID', {
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
      // Get retailer value by checking all split SKUs in line_items
      let retailerValue = "JNL";
      if (order.line_items && order.line_items.length > 0) {
        let foundRetailer = null;
        for (const item of order.line_items) {
          const skuStr = item.sku || '';
          const skus = skuStr.split('+').map(s => s.trim()).filter(Boolean);
          for (const sku of skus) {
            const { data: product, error } = await supabase
              .from('Products')
              .select('Retailer')
              .eq('ProductSKU', sku)
              .single();
            if (!error && product && product.Retailer) {
              foundRetailer = product.Retailer;
              break;
            }
          }
          if (foundRetailer) break;
        }
        if (foundRetailer) retailerValue = foundRetailer;
      }
      // Aggregate SKUs split by plus sign
      let skuMap = {};
      for (const item of (order.line_items || [])) {
        const skuStr = item.sku || '';
        const name = item.title || '';
        const quantity = item.quantity || 0;
        const skus = skuStr.split('+').map(s => s.trim()).filter(Boolean);
        for (const sku of skus) {
          if (!skuMap[sku]) {
            skuMap[sku] = { sku: sku, title: name, quantity: 0 };
          }
          skuMap[sku].quantity += quantity;
        }
      }
      // Convert to array and round quantities
      const itemsArr = Object.values(skuMap).map(obj => ({
        sku: obj.sku,
        title: obj.title,
        quantity: Math.round(obj.quantity)
      }));
      await supabase.from('Orders').upsert({
        OrderID: order.order_number.replace("#",""),
        Retailer: retailerValue,
        Items: itemsArr,
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
