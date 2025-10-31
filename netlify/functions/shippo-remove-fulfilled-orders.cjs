// netlify/functions/shippo-remove-fulfilled-orders.cjs
// Netlify function: Check order statuses in Shippo and remove unpaid orders from Orders table

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

exports.handler = async (event) => {
  console.log('[Shippo Remove Unpaid] Function invoked');

  const SHIPPO_API_KEY = process.env.SHIPPO_API_KEY;
  if (!SHIPPO_API_KEY) {
    console.log('[Shippo Remove Unpaid] Missing Shippo API token');
    return { statusCode: 500, body: 'Missing Shippo API token.' };
  }

  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  let removedCount = 0;
  let checkedCount = 0;
  let errorCount = 0;

  try {
    // Get all orders from the Orders table that have a ShippoOrderID
    const { data: dbOrders, error: ordersError } = await supabase
      .from('Orders')
      .select('OrderID, ShippoOrderID')
      .not('ShippoOrderID', 'is', null);

    if (ordersError) {
      console.error('[Shippo Remove Unpaid] Error fetching orders:', ordersError.message);
      return { statusCode: 500, body: 'Error fetching orders from database: ' + ordersError.message };
    }

    console.log(`[Shippo Remove Unpaid] Found ${dbOrders.length} orders in database to check`);

    // Check each order individually in Shippo
    for (const order of dbOrders) {
      checkedCount++;
      
      try {
        // Get order details from Shippo API using the object_id
        const url = `https://api.goshippo.com/orders/${order.ShippoOrderID}`;
        const resp = await fetch(url, {
          headers: { Authorization: `ShippoToken ${SHIPPO_API_KEY}` }
        });

        if (!resp.ok) {
          if (resp.status === 404) {
            // Order not found in Shippo, remove it from our database
            console.log(`[Shippo Remove Unpaid] Order ${order.OrderID} not found in Shippo, removing`);
            const { error: deleteError } = await supabase
              .from('Orders')
              .delete()
              .eq('OrderID', order.OrderID);
            
            if (deleteError) {
              console.error(`[Shippo Remove Unpaid] Error deleting order ${order.OrderID}:`, deleteError.message);
              errorCount++;
            } else {
              removedCount++;
            }
            continue;
          } else {
            throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
          }
        }

        const orderData = await resp.json();
        
        // Check if order status is not PAID
        if (orderData.order_status !== 'PAID') {
          console.log(`[Shippo Remove Unpaid] Order ${order.OrderID} status is ${orderData.order_status}, removing`);
          
          // Remove the order from our database
          const { error: deleteError } = await supabase
            .from('Orders')
            .delete()
            .eq('OrderID', order.OrderID);
          
          if (deleteError) {
            console.error(`[Shippo Remove Unpaid] Error deleting order ${order.OrderID}:`, deleteError.message);
            errorCount++;
          } else {
            removedCount++;
          }
        } else {
          console.log(`[Shippo Remove Unpaid] Order ${order.OrderID} is PAID, keeping`);
        }

      } catch (err) {
        console.error(`[Shippo Remove Unpaid] Error checking order ${order.OrderID}:`, err.message);
        errorCount++;
      }
    }

    console.log(`[Shippo Remove Unpaid] Checked ${checkedCount} orders, removed ${removedCount}, errors: ${errorCount}`);

  } catch (e) {
    console.error('[Shippo Remove Unpaid] Function error:', e.message);
    return { statusCode: 500, body: 'Error in remove unpaid orders function: ' + e.message };
  }

  return { 
    statusCode: 200, 
    body: `Checked ${checkedCount} orders, removed ${removedCount} unpaid/missing orders, ${errorCount} errors.` 
  };
};
