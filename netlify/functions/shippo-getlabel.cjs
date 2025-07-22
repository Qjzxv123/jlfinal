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
  const isInternational = (order.customer?.country && order.customer.country.toUpperCase() !== 'US');
  let customsDeclarationId = null;
  let shipmentPayload = {
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

  // If international, create customs declaration
  if (isInternational) {
    // Build customs items from products
    const customsItems = (order.products || []).map(product => ({
      description: product.name || 'Merchandise',
      quantity: product.quantity || 1,
      net_weight: product.weight_oz ? (product.weight_oz / 16).toFixed(2) : '0.1', // in lbs, fallback to 0.1
      mass_unit: 'lb',
      value_amount: product.value || 5.00, // fallback value
      value_currency: 'USD',
      origin_country: 'US',
      tariff_number: product.hs_code || ''
    }));
    // Fallback if no products
    if (customsItems.length === 0) {
      customsItems.push({
        description: 'Merchandise',
        quantity: 1,
        net_weight: '0.1',
        mass_unit: 'lb',
        value_amount: 5.00,
        value_currency: 'USD',
        origin_country: 'US',
        tariff_number: ''
      });
    }
    // Create customs declaration
    try {
      const customsResp = await fetch('https://api.goshippo.com/customs/declarations/', {
        method: 'POST',
        headers: {
          'Authorization': `ShippoToken ${SHIPPO_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          certify: true,
          certify_signer: 'J&L Naturals',
          contents_type: 'MERCHANDISE',
          eel_pfc: 'NOEEI_30_37_a',
          non_delivery_option: 'RETURN',
          items: customsItems
        })
      });
      const customsData = await customsResp.json();
      if (customsResp.ok && customsData.object_id) {
        customsDeclarationId = customsData.object_id;
        shipmentPayload.customs_declaration = customsDeclarationId;
      } else {
        console.error('[Shippo Label] Customs declaration error:', customsData);
        return { statusCode: 500, body: 'Error creating customs declaration: ' + (customsData.detail || 'Unknown error'), debug: customsData };
      }
    } catch (err) {
      console.error('[Shippo Label] Exception during customs declaration:', err);
      return { statusCode: 500, body: 'Error creating customs declaration: ' + err.message };
    }
  }

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
      body: JSON.stringify({ rate: rate_id, label_file_type: 'PDF'})
    });
    const transactionText = await transactionResp.text();
    let transaction;
    try {
      transaction = JSON.parse(transactionText);
    } catch (parseErr) {
      console.error('[Shippo Label] Failed to parse transaction response:', transactionText);
      return { statusCode: 500, body: 'Error buying label: Invalid JSON response from Shippo.' };
    }
    // If label_url is missing and status is QUEUED, poll for completion
    if (transaction.status === 'QUEUED' && transaction.object_id) {
      const pollUrl = `https://api.goshippo.com/transactions/${transaction.object_id}`;
      let pollCount = 0;
      const maxPolls = 10; // up to 10 times
      const pollDelay = 2000; // 2 seconds
      let pollTransaction = transaction;
      while (pollCount < maxPolls && (!pollTransaction.label_url && pollTransaction.status !== 'ERROR')) {
        await new Promise(res => setTimeout(res, pollDelay));
        pollCount++;
        try {
          const pollResp = await fetch(pollUrl, {
            method: 'GET',
            headers: {
              'Authorization': `ShippoToken ${SHIPPO_API_KEY}`,
              'Content-Type': 'application/json'
            }
          });
          pollTransaction = await pollResp.json();
          if (pollTransaction.status === 'SUCCESS' && pollTransaction.label_url) {
            break;
          }
          if (pollTransaction.status === 'ERROR') {
            break;
          }
        } catch (pollErr) {
          console.error('[Shippo Label] Polling error:', pollErr);
          break;
        }
      }
      transaction.label_url = pollTransaction.label_url;
      transaction.amount = pollTransaction.amount;
      transaction.status = pollTransaction.status;
      transaction.messages = pollTransaction.messages;
    }
    if (!transaction.label_url || transaction.status === 'ERROR') {
      console.error('[Shippo Label] Label purchase failed:', {
        status: transactionResp.status,
        statusText: transactionResp.statusText,
        transaction
      });
      let errorMsg = 'No label_url';
      if (transaction.messages && Array.isArray(transaction.messages) && transaction.messages.length > 0) {
        errorMsg = transaction.messages.map(m => m.text).join('; ');
      } else if (transaction.detail) {
        errorMsg = transaction.detail;
      }
      return { statusCode: 500, body: 'Error buying label: ' + errorMsg, debug: transaction };
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
