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
  
  // Handle batch label purchasing
  if (body.action === 'purchase_labels' && body.orderParcels) {
    return await handleBatchLabelPurchase(body.orderParcels, SHIPPO_API_KEY);
  }
  
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
    parcels: parcelsArr
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
  try {
    // Reference the Shippo order's object_id in the transaction request
    const transactionBody = {
      rate: rate_id,
      label_file_type: 'PDF_4x6'
    };
    // Add address and order IDs only to transaction payload
    if (body.ShippoAddressID && body.ShippoAddressID.trim() !== '') {
      transactionBody.address_to = body.ShippoAddressID;
    } else if (order.toAddressObjectID && order.toAddressObjectID.trim() !== '') {
      transactionBody.address_to = order.toAddressObjectID;
    }
    if (order && order.ShippoObjectID) {
      transactionBody.order = order.ShippoObjectID;
    } else if (shipment && shipment.object_id) {
      transactionBody.order = shipment.object_id;
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

// Handle batch label purchasing using Shippo Batch API
async function handleBatchLabelPurchase(orderParcels, SHIPPO_API_KEY) {
  console.log('[Batch Label] Starting batch purchase for', orderParcels.length, 'orders');
  
  try {
    // Step 1: Create batch shipments array
    const batchShipments = [];
    
    for (const {order, parcel, selectedRate} of orderParcels) {
      if (!selectedRate || !selectedRate.object_id) {
        console.error('[Batch Label] Missing rate for order:', order.orderNumber);
        continue;
      }
      
      // Build address_to
      let address_to = order.ShippoAddressID && order.ShippoAddressID.trim() !== '' ? order.ShippoAddressID
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

      // Build parcels array
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
        console.error('[Batch Label] Invalid parcel data for order:', order.orderNumber);
        continue;
      }

      // Create shipment payload
      const shipmentPayload = {
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
        parcels: parcelsArr
      };

      // Handle international shipments (customs declaration)
      const isInternational = order.customer?.country && order.customer.country.toUpperCase() !== 'US';
      if (isInternational) {
        const customsItems = (order.products || []).map(product => ({
          description: product.name || 'Merchandise',
          quantity: product.quantity || 1,
          net_weight: product.weight_oz ? (product.weight_oz / 16).toFixed(2) : '0.1',
          mass_unit: 'lb',
          value_amount: product.value || 5.00,
          value_currency: 'USD',
          origin_country: 'US',
          tariff_number: product.hs_code || ''
        }));
        
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
            shipmentPayload.customs_declaration = customsData.object_id;
          } else {
            console.error('[Batch Label] Customs declaration error for order:', order.orderNumber, customsData);
            continue;
          }
        } catch (err) {
          console.error('[Batch Label] Exception during customs declaration for order:', order.orderNumber, err);
          continue;
        }
      }

      // Add to batch shipments
      batchShipments.push({
        carrier_account: selectedRate.carrier_account || null,
        servicelevel_token: selectedRate.servicelevel?.token || null,
        shipment: shipmentPayload,
        metadata: order.orderNumber
      });
    }

    if (batchShipments.length === 0) {
      return { statusCode: 400, body: 'No valid shipments to process in batch' };
    }

    console.log('[Batch Label] Creating batch with', batchShipments.length, 'shipments');

    // Step 2: Create the batch
    const batchPayload = {
      batch_shipments: batchShipments,
      label_filetype: 'PDF_4x6',
      metadata: `Batch created ${new Date().toISOString()}`
    };

    const batchResp = await fetch('https://api.goshippo.com/batches/', {
      method: 'POST',
      headers: {
        'Authorization': `ShippoToken ${SHIPPO_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(batchPayload)
    });

    const batchData = await batchResp.json();
    if (!batchResp.ok || !batchData.object_id) {
      console.error('[Batch Label] Failed to create batch:', batchData);
      return { statusCode: 500, body: 'Failed to create batch: ' + (batchData.detail || 'Unknown error') };
    }

    const batchId = batchData.object_id;
    console.log('[Batch Label] Batch created with ID:', batchId);

    // Step 3: Poll for batch validation
    let attempts = 0;
    const maxAttempts = 30; // 30 attempts * 2 seconds = 1 minute max wait
    let batchStatus = batchData.status;

    while (attempts < maxAttempts && batchStatus === 'VALIDATING') {
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
      attempts++;

      const statusResp = await fetch(`https://api.goshippo.com/batches/${batchId}`, {
        method: 'GET',
        headers: {
          'Authorization': `ShippoToken ${SHIPPO_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      const statusData = await statusResp.json();
      if (statusResp.ok) {
        batchStatus = statusData.status;
        console.log('[Batch Label] Batch status:', batchStatus, 'Attempt:', attempts);
      } else {
        console.error('[Batch Label] Error checking batch status:', statusData);
        break;
      }
    }

    if (batchStatus !== 'VALID') {
      console.error('[Batch Label] Batch validation failed. Status:', batchStatus);
      return { statusCode: 500, body: `Batch validation failed with status: ${batchStatus}` };
    }

    console.log('[Batch Label] Batch validated successfully, purchasing labels...');

    // Step 4: Purchase the batch
    const purchaseResp = await fetch(`https://api.goshippo.com/batches/${batchId}/purchase`, {
      method: 'POST',
      headers: {
        'Authorization': `ShippoToken ${SHIPPO_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: ''
    });

    const purchaseData = await purchaseResp.json();
    if (!purchaseResp.ok) {
      console.error('[Batch Label] Failed to purchase batch:', purchaseData);
      return { statusCode: 500, body: 'Failed to purchase batch: ' + (purchaseData.detail || 'Unknown error') };
    }

    console.log('[Batch Label] Batch purchase initiated, polling for completion...');

    // Step 5: Poll for purchase completion
    attempts = 0;
    let purchaseStatus = purchaseData.status;

    while (attempts < maxAttempts && (purchaseStatus === 'PURCHASING' || purchaseStatus === 'VALID')) {
      await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds for purchases
      attempts++;

      const statusResp = await fetch(`https://api.goshippo.com/batches/${batchId}`, {
        method: 'GET',
        headers: {
          'Authorization': `ShippoToken ${SHIPPO_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      const statusData = await statusResp.json();
      if (statusResp.ok) {
        purchaseStatus = statusData.status;
        console.log('[Batch Label] Purchase status:', purchaseStatus, 'Attempt:', attempts);
        
        // Check if we have label URLs ready
        if (statusData.label_url && Array.isArray(statusData.label_url) && statusData.label_url.length > 0) {
          console.log('[Batch Label] Labels ready!');
          return {
            statusCode: 200,
            body: JSON.stringify({
              success: true,
              batch_id: batchId,
              label_urls: statusData.label_url,
              status: statusData.status,
              results: statusData.object_results
            })
          };
        }
      } else {
        console.error('[Batch Label] Error checking purchase status:', statusData);
        break;
      }
    }

    // If we get here, either polling timed out or there was an issue
    console.error('[Batch Label] Purchase polling completed but labels may not be ready. Final status:', purchaseStatus);
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: false,
        batch_id: batchId,
        status: purchaseStatus,
        message: 'Batch purchase initiated but labels are not ready yet. Check batch status manually.',
        polling_timeout: true
      })
    };

  } catch (error) {
    console.error('[Batch Label] Exception during batch processing:', error);
    return { statusCode: 500, body: 'Error processing batch: ' + error.message };
  }
}
