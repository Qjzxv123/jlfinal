// netlify/functions/shippo-get-tracking.cjs
// Fetch tracking status for a Shippo transaction or tracking number (server-side to keep API key secret).

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const SHIPPO_API_KEY = process.env.SHIPPO_API_KEY;
  if (!SHIPPO_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing Shippo API token' }) };
  }

  let payload = {};
  try { payload = JSON.parse(event.body || '{}'); } catch (_) { payload = {}; }
  const trackingNumber = payload.trackingNumber || payload.tracking_code;
  const shippoOrderId = payload.shippoOrderId || payload.shippo_order_id;

  if (!trackingNumber && !shippoOrderId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'trackingNumber or shippoOrderId is required' }) };
  }

  try {
    let trackingData = null;

    if (shippoOrderId) {
      const resp = await fetch(`https://api.goshippo.com/transactions/${encodeURIComponent(shippoOrderId)}`, {
        headers: { Authorization: `ShippoToken ${SHIPPO_API_KEY}` }
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.detail || data.error || 'Failed to fetch transaction');
      trackingData = data.tracking_status || null;
      // Include history if available
      if (data.tracking_history) trackingData = { ...trackingData, history: data.tracking_history };
    }

    if (!trackingData && trackingNumber) {
      // As a fallback, try the tracking endpoint with unknown carrier using Shippo's autodetect (if enabled for the account)
      const resp = await fetch('https://api.goshippo.com/tracks/', {
        method: 'POST',
        headers: {
          Authorization: `ShippoToken ${SHIPPO_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ tracking_number: trackingNumber })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.detail || data.error || 'Failed to fetch tracking');
      trackingData = data.tracking_status || null;
      if (data.tracking_history) trackingData = { ...trackingData, history: data.tracking_history };
    }

    if (!trackingData) {
      return { statusCode: 404, body: JSON.stringify({ error: 'No tracking data available.' }) };
    }

    const status = {
      status: trackingData.status || trackingData.substatus || 'Unknown',
      statusDetails: trackingData.status_details || trackingData.substatus || '',
      statusDate: trackingData.status_date || trackingData.status_date_time || null,
      location: trackingData.location || null,
      eta: trackingData.eta || null,
      history: trackingData.history || trackingData.tracking_history || []
    };

    return { statusCode: 200, body: JSON.stringify(status) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Tracking lookup failed' }) };
  }
};
