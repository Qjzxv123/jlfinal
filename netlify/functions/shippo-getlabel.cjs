// netlify/functions/shippo-getlabel.cjs
// Endpoint to create a shipping label using Shippo API

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
exports.handler = async (event) => {
  // Validate request
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  const SHIPPO_API_KEY = process.env.SHIPPO_API_KEY;
  if (!SHIPPO_API_KEY) return { statusCode: 500, body: 'Missing Shippo API token.' };
  let body;
  try { body = JSON.parse(event.body); } catch (err) { return { statusCode: 400, body: 'Invalid JSON body.' }; }
  const { order, parcel, rate_id } = body;
  if (!order || !parcel) return { statusCode: 400, body: 'Missing order or parcel data.' };

  // Build parcels array
  // Validate parcel(s) and build parcelsArr
  let parcelsArr = [];
  if (Array.isArray(parcel)) {
    parcelsArr = parcel
      .filter(box => box && box.length && box.width && box.height && box.weight)
      .map(box => ({
        length: Number(box.length),
        width: Number(box.width),
        height: Number(box.height),
        distance_unit: 'in',
        weight: Number(box.weight),
        mass_unit: 'oz'
      }));
  } else if (parcel && parcel.length && parcel.width && parcel.height && parcel.weight) {
    parcelsArr = [{
      length: Number(parcel.length),
      width: Number(parcel.width),
      height: Number(parcel.height),
      distance_unit: 'in',
      weight: Number(parcel.weight),
      mass_unit: 'oz'
    }];
  }
  if (!parcelsArr.length) {
    console.error('[Shippo Label] Invalid or missing parcel data:', parcel);
    return { statusCode: 400, body: 'Invalid or missing parcel/package data.' };
  }

  // Log parcelsArr for debugging
  console.log('[Shippo Label] parcelsArr:', parcelsArr);

  // Build address_to
  let address_to = body.ShippoAddressID && body.ShippoAddressID.trim() !== '' ? body.ShippoAddressID
: order.toAddressObjectID && order.toAddressObjectID.trim() !== ''
      ? order.toAddressObjectID
      : {
          name: order.customer?.name || '',
          street1: order.customer?.address1 || '',
          street2: order.customer?.address2 || '',
          city: order.customer?.city || '',
          state: order.customer?.state || '',
          zip: order.customer?.zipCode || '',
          country: order.customer?.country || '',
          phone: order.customer?.phone || '',
          email: order.customer?.email || ''
        };

  // Build shipment payload
  const isInternational = order.customer?.country && order.customer.country.toUpperCase() !== 'US';
  let shipmentPayload = {
    address_from: {
      name: 'J&L Naturals',
      street1: "125 N Commercial Dr #103",
      city: 'Mooreseville',
      state: 'NC',
      zip: '28115',
      country: 'US',
      phone: '7046777577',
      email: 'jenn@jnlnaturals.com'
    },
    address_to,
    parcels: parcelsArr,
    extra: {
      bypass_address_validation: true
    }
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
    const shipmentText = await shipmentResp.text();
    // Removed full shipment response log for rates
    try {
      shipment = JSON.parse(shipmentText);
    } catch (parseErr) {
      console.error('[Shippo Label] Failed to parse shipment response:', shipmentText);
      return { statusCode: 500, body: 'Error parsing shipment response from Shippo.' };
    }
    if (!shipmentResp.ok || !shipment.object_id) {
      return { statusCode: 500, body: 'Error creating shipment: ' + (shipment.detail || 'No object_id'), debug: shipment };
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
  let trackingNumber = null;
  let carrier = null;
  try {
    // Create transaction payload for label purchase
    const transactionBody = {
      rate: rate_id,
      label_file_type: 'PDF_4x6'
    };
    // Add address ID if available (optional for transactions)
    if (body.ShippoAddressID && body.ShippoAddressID.trim() !== '') {
      transactionBody.address_to = body.ShippoAddressID;
    } else if (order.toAddressObjectID && order.toAddressObjectID.trim() !== '') {
      transactionBody.address_to = order.toAddressObjectID;
    }
    // Add order reference only if it exists and not a Faire order
    const isFaireOrder = order.platform === 'faire' || order.source === 'faire' || 
                        (order.id && order.id.toString().startsWith('faire_'));
    
    if (!isFaireOrder && order && order.ShippoOrderID && order.ShippoOrderID.trim() !== '') {
      transactionBody.order = order.ShippoOrderID;
    }
    const transactionResp = await fetch('https://api.goshippo.com/transactions/', {
      method: 'POST',
      headers: {
        'Authorization': `ShippoToken ${SHIPPO_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(transactionBody)
    });
    const transactionText = await transactionResp.text();
    // Log the full raw response from Shippo for label purchase
    console.log('[Shippo Label] Full transaction response (raw):', transactionText);
    // Also log the parsed JSON response for clarity
    let transaction;
    try {
      transaction = JSON.parse(transactionText);
      console.log('[Shippo Label] Full transaction response (parsed):', transaction);
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
      // Also copy tracking information from polled transaction
      transaction.tracking_number = pollTransaction.tracking_number;
      transaction.tracking_code = pollTransaction.tracking_code;
      transaction.rate = pollTransaction.rate;
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
    
    // Extract tracking information and carrier details
    trackingNumber = transaction.tracking_number || transaction.tracking_code;
    carrier = transaction.rate?.provider || transaction.rate?.carrier;
    
    // If tracking number not found in transaction, try to get it from the rate
    if (!trackingNumber && transaction.rate) {
      trackingNumber = transaction.rate.tracking_number || transaction.rate.tracking_code;
    }
    
    // Try to find tracking number in the label response metadata
    if (!trackingNumber && transaction.metadata) {
      trackingNumber = transaction.metadata.tracking_number || transaction.metadata.tracking_code;
    }
    
    // Log the transaction object for debugging
    console.log('[Shippo Label] Transaction object for tracking extraction:', JSON.stringify(transaction, null, 2));
    
  } catch (err) {
    console.error('[Shippo Label] Exception during label purchase:', err);
    return { statusCode: 500, body: 'Error buying label: ' + err.message };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ 
      label_url: labelUrl, 
      shipping_cost: shippingCost,
      tracking_number: trackingNumber,
      carrier: carrier,
      amount: shippingCost // Include amount for consistency
    })
  };
};
