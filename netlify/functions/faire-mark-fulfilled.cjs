// Netlify serverless function to mark Faire orders as fulfilled
// Endpoint: /.netlify/functions/faire-mark-fulfilled
// Usage: POST with { orderId: string } in body

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
let getTokenRow;
try {
  getTokenRow = require('./faire-token-utils.cjs').getTokenRow;
} catch (e) {
  try {
    getTokenRow = require('./faire-token-utils.js').getTokenRow;
  } catch (e2) {
    getTokenRow = async () => { throw new Error('getTokenRow is not available'); };
  }
}

exports.handler = async function(event, context) {
  try {
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: 'Method Not Allowed' })
      };
    }
    const body = JSON.parse(event.body || '{}');
    let orderId = body.orderId;
    let shipments = body.shipments;
    // Accept either {orderId} or {shipments: [...]}, prefer shipments
    if (!shipments && orderId) {
      // Build a default shipment if only orderId is provided
      shipments = [{ order_id: orderId }];
    }
    if (!shipments || !Array.isArray(shipments) || shipments.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing shipments array' })
      };
    }
    // Get Faire OAuth token row (assume single account, or use env/user if needed)
    const user_key = body.user_key || process.env.FAIRE_USER_KEY || 'default';
    let tokenRow;
    try {
      tokenRow = await getTokenRow(user_key);
    } catch (err) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Unable to get Faire OAuth token', details: err.message, user_key })
      };
    }
    if (!tokenRow || !tokenRow.access_token) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'No Faire access token found in DB', user_key })
      };
    }
    const accessToken = tokenRow.access_token;
    // Use first shipment's order_id for endpoint
    const url = `https://www.faire.com/external-api/v2/orders/${shipments[0].order_id}/shipments`;
    // Add Faire client ID to headers
    const faireClientId = process.env.FAIRE_CLIENT_ID || '';

    // Validate shipments: tracking_code is required and must not be empty
    for (const s of shipments) {
      if (!s.tracking_code || typeof s.tracking_code !== 'string' || !s.tracking_code.trim()) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'tracking_code is required for each shipment and must not be empty', shipment: s })
        };
      }
      if (!s.carrier || typeof s.carrier !== 'string' || !s.carrier.trim()) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'carrier is required for each shipment and must not be empty', shipment: s })
        };
      }
    }

    // Compose credentials for new Faire API header
    const faireClientSecret = process.env.FAIRE_CLIENT_SECRET || '';
    const credentials = Buffer.from(`${faireClientId}:${faireClientSecret}`).toString('base64');
    let response, result;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'X-FAIRE-APP-CREDENTIALS': credentials,
          'X-FAIRE-OAUTH-ACCESS-TOKEN': accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ shipments })
      });
      result = await response.json();
    } catch (err) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Network or fetch error', details: err.message, user_key, url, shipments })
      };
    }
    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: result.error || 'Failed to mark order as fulfilled', details: result })
      };
    }
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, result })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
