// netlify/functions/shippo-getlabel.cjs
// Endpoint to create a shipping label using Shippo API

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const SHIPPO_API_KEY = process.env.SHIPPO_API_KEY;
  if (!SHIPPO_API_KEY) {
    return { statusCode: 500, body: 'Missing Shippo API token.' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (err) {
    return { statusCode: 400, body: 'Invalid JSON body.' };
  }

  const { order, parcel, rate_id } = body;
  if (!order || !parcel) {
    return { statusCode: 400, body: 'Missing order or parcel data.' };
  }

  // Support multiple boxes: parcel can be an array of box objects
  let parcelsArr = [];
  if (Array.isArray(parcel)) {
    parcelsArr = parcel.map(box => ({
      length: box.length,
      width: box.width,
      height: box.height,
      distance_unit: 'in',
      weight: box.weight,
      mass_unit: 'oz'
    }));
  } else {
    parcelsArr = [{
      length: parcel.length,
      width: parcel.width,
      height: parcel.height,
      distance_unit: 'in',
      weight: parcel.weight,
      mass_unit: 'oz'
    }];
  }

  // Build Shippo shipment payload
  const shipmentPayload = {
    address_from: {
      name: 'J&L Naturals',
      street1: "125 N Commercial Dr #103",
      city: 'Mooreseville',
      state: 'NC',
      zip: '28115',
      country: 'US',
    },
    address_to: {
      name: order.customer?.name || '',
      street1: order.customer?.address1 || '',
      street2: order.customer?.address2 || '',
      city: order.customer?.city || '',
      state: order.customer?.state || '',
      zip: order.customer?.zipCode || '',
      country: order.customer?.country || 'US',
      phone: order.customer?.phone || '',
      email: order.customer?.email || ''
    },
    parcels: parcelsArr,
    async: false
  };

  // Create shipment in Shippo
  let shipment;
  try {
    const shipmentResp = await fetch('https://api.goshippo.com/shipments/', {
      method: 'POST',
      headers: {
        'Authorization': `ShippoToken ${SHIPPO_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(shipmentPayload)
    });
    shipment = await shipmentResp.json();
    if (!shipmentResp.ok || !shipment.object_id) {
      return { statusCode: 500, body: 'Error creating shipment: ' + (shipment.detail || 'No object_id') };
    }
  } catch (err) {
    return { statusCode: 500, body: 'Error creating shipment: ' + err.message };
  }

  // If no rate_id provided, return available rates for user selection
  const rates = shipment.rates || [];
  if (!rate_id) {
    if (rates.length === 0) {
      return { statusCode: 500, body: 'No rates returned from Shippo.' };
    }
    // Return rates for user to choose
    return {
      statusCode: 200,
      body: JSON.stringify({ rates })
    };
  }

  // Buy label with selected rate
  let labelUrl = null;
  let shippingCost = null;
  try {
    const transactionResp = await fetch('https://api.goshippo.com/transactions/', {
      method: 'POST',
      headers: {
        'Authorization': `ShippoToken ${SHIPPO_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ rate: rate_id, label_file_type: 'PDF' })
    });
    const transactionText = await transactionResp.text();
    let transaction;
    try {
      transaction = JSON.parse(transactionText);
    } catch (parseErr) {
      console.error('[Shippo Label] Failed to parse transaction response:', transactionText);
      return { statusCode: 500, body: 'Error buying label: Invalid JSON response from Shippo.' };
    }
    if (!transactionResp.ok || !transaction.label_url) {
      console.error('[Shippo Label] Label purchase failed:', {
        status: transactionResp.status,
        statusText: transactionResp.statusText,
        transaction
      });
      return { statusCode: 500, body: 'Error buying label: ' + (transaction.detail || 'No label_url'), debug: transaction };
    }
    labelUrl = transaction.label_url;
    shippingCost = transaction.amount;
  } catch (err) {
    console.error('[Shippo Label] Exception during label purchase:', err);
    return { statusCode: 500, body: 'Error buying label: ' + err.message };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ label_url: labelUrl, shipping_cost: shippingCost })
  };
};
