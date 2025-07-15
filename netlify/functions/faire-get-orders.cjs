// netlify/functions/faire-get-orders.cjs

const { getValidToken } = require('./faire-token-utils.cjs');
let fetchFn;
if (typeof fetch !== 'undefined') {
  fetchFn = fetch;
} else {
  fetchFn = require('node-fetch');
}

exports.handler = async (event) => {
  try {
    // Get userKey from query or body (customize as needed)

    let userKey;
    // Netlify passes queryStringParameters as an object, not a string
    if (event.httpMethod === 'GET') {
      userKey = event.queryStringParameters && event.queryStringParameters.userKey;
    } else if (event.httpMethod === 'POST') {
      try {
        const body = JSON.parse(event.body || '{}');
        userKey = body.userKey;
      } catch (e) {
        console.error('[ERROR] Invalid JSON body:', e);
        return { statusCode: 400, body: 'Invalid JSON body' };
      }
    }
    if (!userKey) {
      return { statusCode: 400, body: 'Missing userKey' };
    }

    let apiToken;
    try {
      apiToken = await getValidToken(userKey);
    } catch (tokenErr) {
      console.error('[ERROR] Token error:', tokenErr);
      return {
        statusCode: 401,
        body: JSON.stringify({
          error: 'Token error',
          message: tokenErr.message,
          stack: tokenErr.stack
        })
      };
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
      console.error('[ERROR] Fetch to Faire API failed:', fetchErr);
      return { statusCode: 502, body: 'Failed to reach Faire API' };
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[ERROR] Faire API error:', response.status, errorText);
      return { statusCode: response.status, body: errorText };
    }

    let data;
    try {
      data = await response.json();
    } catch (jsonErr) {
      console.error('[ERROR] Failed to parse Faire API response as JSON:', jsonErr);
      return { statusCode: 502, body: 'Invalid JSON from Faire API' };
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
        ShipTo_Country: shippingDetails.country || ''
      };
      orders.push(orderData);
    }
    console.log(`Added ${orders.length} orders to Supabase`);
    return {
      statusCode: 200,
      body: JSON.stringify(orders)
    };
  } catch (err) {
    console.error('[ERROR] Internal server error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Internal server error',
        message: err.message,
        stack: err.stack
      })
    };
  }
};
