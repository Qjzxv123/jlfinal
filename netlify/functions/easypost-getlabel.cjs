// Netlify function: easypost-getlabel.cjs
// Creates shipping label via EasyPost API for non-Etsy platforms
// Expects POST { order, parcel, rate_id? }

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const EasyPostApiKey = process.env.EASYPOST_API_KEY;

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (err) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { order, parcel, rate_id } = body;
  if (!order || !parcel) {
    return { statusCode: 400, body: 'Missing order or parcel' };
  }

  // Build EasyPost shipment
  // You may want to adjust address mapping for your platforms
  const toAddress = {
    name: order.customer.name || 'Customer',
    street1: order.customer.address1 || '',
    street2: order.customer.address2 || '',
    city: order.customer.city || '',
    state: order.customer.state || '',
    zip: order.customer.zipCode || '',
    country: order.customer.country || 'US',
    phone: order.customer.phone || '',
    email: order.customer.email || ''
  };
  const fromAddress = {
    name: 'J&L Naturals',
      street1: "125 N Commercial Dr #103",
      city: 'Mooreseville',
      state: 'NC',
      zip: '28115',
      country: 'US',
  };
  // Use first box for parcel dimensions
  const box = parcel.boxes && parcel.boxes.length > 0 ? parcel.boxes[0] : parcel;
  const shipmentParcel = {
    length: box.length || 6,
    width: box.width || 6,
    height: box.height || 2,
    weight: Math.max(1, Math.round((parcel.weight || 1) * 28.35)), // oz to grams
  };

  // Step 1: Create shipment
  let shipmentResp;
  try {
    shipmentResp = await fetch('https://api.easypost.com/v2/shipments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${EasyPostApiKey}`
      },
      body: JSON.stringify({
        shipment: {
          to_address: toAddress,
          from_address: fromAddress,
          parcel: shipmentParcel
        }
      })
    });
    if (!shipmentResp.ok) {
      const errText = await shipmentResp.text();
      return { statusCode: shipmentResp.status, body: errText };
    }
  } catch (err) {
    return { statusCode: 500, body: 'EasyPost shipment error: ' + err.message };
  }
  const shipment = await shipmentResp.json();
  if (!shipment.rates || !Array.isArray(shipment.rates) || shipment.rates.length === 0) {
    return { statusCode: 200, body: JSON.stringify({ rates: [] }) };
  }

  // Step 2: If no rate_id, return rates for selection
  if (!rate_id) {
    // Map rates to Shippo-like format for frontend
    const rates = shipment.rates.map(rate => ({
      object_id: rate.id,
      provider: rate.carrier,
      servicelevel_name: rate.service,
      amount: rate.rate,
      duration_terms: rate.delivery_days ? `${rate.delivery_days} days` : '',
      estimated_days: rate.delivery_days || null
    }));
    return {
      statusCode: 200,
      body: JSON.stringify({ rates })
    };
  }

  // Step 3: Buy label with selected rate
  let buyResp;
  try {
    buyResp = await fetch(`https://api.easypost.com/v2/shipments/${shipment.id}/buy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${EasyPostApiKey}`
      },
      body: JSON.stringify({ rate: { id: rate_id } })
    });
    if (!buyResp.ok) {
      const errText = await buyResp.text();
      return { statusCode: buyResp.status, body: errText };
    }
  } catch (err) {
    return { statusCode: 500, body: 'EasyPost buy error: ' + err.message };
  }
  const buyData = await buyResp.json();
  return {
    statusCode: 200,
    body: JSON.stringify({ label_url: buyData.postage_label && buyData.postage_label.label_url ? buyData.postage_label.label_url : null })
  };
};
