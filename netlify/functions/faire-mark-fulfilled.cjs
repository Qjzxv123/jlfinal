// Netlify serverless function to mark Faire orders as fulfilled
// Endpoint: /.netlify/functions/faire-mark-fulfilled
// Usage: POST with { orderId: string } in body

const fetch = require('node-fetch');
const { getFaireAccessToken } = require('./faire-token-utils.cjs');

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
    // Get Faire access token (refresh if needed)
    const accessToken = await getFaireAccessToken();
    if (!accessToken) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Unable to get Faire access token' })
      };
    }
    // Use first shipment's order_id for endpoint
    const url = `https://www.faire.com/external-api/v2/orders/${shipments[0].order_id}/shipments`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ shipments })
    });
    const result = await response.json();
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
