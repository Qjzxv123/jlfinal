// netlify/functions/shippo-batch-label.cjs
// Creates and purchases labels for a batch of orders, moves them to Order History,
// decrements box inventory, fulfills Faire orders, and returns label URLs for printing.

// Cache fetch module at cold start
let fetchModule;
const getFetch = async () => {
	if (!fetchModule) {
		fetchModule = await import('node-fetch');
	}
	return fetchModule.default;
};

const { createClient } = require('@supabase/supabase-js');

let getTokenRow = null;
try {
	({ getTokenRow } = require('./faire-token-utils.cjs'));
} catch (err) {
	console.warn('[shippo-batch-label] Unable to load faire-token-utils:', err?.message || err);
}

const SHIPPO_API_KEY = process.env.SHIPPO_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const FAIRE_CLIENT_ID = process.env.FAIRE_CLIENT_ID || '';
const FAIRE_CLIENT_SECRET = process.env.FAIRE_CLIENT_SECRET || '';

exports.handler = async (event) => {
	try {
		if (event.httpMethod !== 'POST') {
			console.error('[shippo-batch-label] Invalid HTTP method:', event.httpMethod);
			return jsonResponse(405, { error: 'Method Not Allowed' });
		}
		if (!SHIPPO_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
			console.error('[shippo-batch-label] Missing configuration:', { 
				hasShippoKey: !!SHIPPO_API_KEY, 
				hasSupabaseUrl: !!SUPABASE_URL, 
				hasSupabaseKey: !!SUPABASE_SERVICE_KEY 
			});
			return jsonResponse(500, { error: 'Missing required server configuration.' });
		}
		let payload;
		try {
			payload = JSON.parse(event.body || '{}');
		} catch (err) {
			console.error('[shippo-batch-label] JSON parse error:', err);
			return jsonResponse(400, { error: 'Invalid JSON body.' });
		}
		const orders = Array.isArray(payload.orders) ? payload.orders : [];
		if (!orders.length) {
			console.error('[shippo-batch-label] No orders in payload');
			return jsonResponse(400, { error: 'No orders supplied.' });
		}

		const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
		
		// Process all orders in parallel
		const results = await Promise.all(
			orders.map(async (entry) => {
				const orderId = entry?.orderId;
				const rateId = entry?.rateId;
				const packages = Array.isArray(entry?.packages) ? entry.packages : [];
				const orderData = entry?.orderData || {};
				const rateMeta = entry?.rate || {};
				
				if (!orderId || !rateId) {
					console.error('[shippo-batch-label] Missing orderId or rateId:', { orderId, rateId });
					return {
						orderId,
						success: false,
						error: 'Missing orderId or rateId in request payload.'
					};
				}

				const normalizedOrderId = String(orderId);
				const warnings = [];
				let labelInfo = null;

				try {
					labelInfo = await purchaseLabel({
						rateId,
						orderData,
						rateMeta
					});
				} catch (err) {
					console.error('[shippo-batch-label] Label purchase failed for order:', normalizedOrderId, err);
					return {
						orderId: normalizedOrderId,
						success: false,
						error: `Label purchase failed: ${err?.message || err}`
					};
				}

				// Parallelize database operations (Order History, remove from Orders, box inventory)
				const [historyResult, removeResult, boxWarnings] = await Promise.allSettled([
					upsertOrderHistory({ supabase, orderData, packages, labelInfo, rateMeta }),
					removeOrderFromActive({ supabase, orderId: normalizedOrderId }),
					decrementBoxesInventory({ supabase, packages })
				]);

				if (historyResult.status === 'rejected') {
					console.error('[shippo-batch-label] Order History update failed for order:', normalizedOrderId, historyResult.reason);
					warnings.push(`Order History update failed: ${historyResult.reason?.message || historyResult.reason}`);
				}
				if (removeResult.status === 'rejected') {
					console.error('[shippo-batch-label] Failed to remove order from active list:', normalizedOrderId, removeResult.reason);
					warnings.push(`Failed to remove order from active list: ${removeResult.reason?.message || removeResult.reason}`);
				}
				if (boxWarnings.status === 'fulfilled' && Array.isArray(boxWarnings.value)) {
					warnings.push(...boxWarnings.value);
				} else if (boxWarnings.status === 'rejected') {
					console.error('[shippo-batch-label] Box inventory update failed for order:', normalizedOrderId, boxWarnings.reason);
					warnings.push(`Box inventory update failed: ${boxWarnings.reason?.message || boxWarnings.reason}`);
				}

				// Faire fulfillment (if applicable)
				if (isFaireOrder(orderData)) {
					try {
						await fulfillFaireOrder({
							orderData,
							trackingNumber: labelInfo.trackingNumber,
							carrier: labelInfo.carrier || rateMeta.provider || rateMeta.carrier || 'UNKNOWN',
							shippingCost: labelInfo.shippingCost
						});
					} catch (err) {
						console.error('[shippo-batch-label] Faire fulfillment failed for order:', normalizedOrderId, err);
						warnings.push(`Faire fulfillment failed: ${err?.message || err}`);
					}
				}

				return {
					orderId: normalizedOrderId,
					success: warnings.length === 0,
					labelUrl: labelInfo.labelUrl,
					trackingNumber: labelInfo.trackingNumber,
					shippingCost: labelInfo.shippingCost,
					carrier: labelInfo.carrier || rateMeta.provider || rateMeta.carrier || null,
					warnings
				};
			})
		);

		return jsonResponse(200, { results });
	} catch (err) {
		console.error('[shippo-batch-label] Unexpected error:', err);
		return jsonResponse(500, { error: err?.message || 'Unexpected server error' });
	}
};

function jsonResponse(statusCode, body) {
	return {
		statusCode,
		body: JSON.stringify(body)
	};
}

async function purchaseLabel({ rateId, orderData, rateMeta }) {
	const fetch = await getFetch();
	
	const transactionBody = {
		rate: rateId,
		label_file_type: 'PDF_4x6'
	};
	const platform = (orderData?.Platform || orderData?.platform || '').toLowerCase();
	const shippoOrderId = orderData?.ShippoOrderID || orderData?.shippo_order_id || orderData?.shippoOrderId;
	if (shippoOrderId && platform !== 'faire') {
		transactionBody.order = shippoOrderId;
	}else{
		metadata="Faire";
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
	let transaction;
	try {
		transaction = JSON.parse(transactionText);
	} catch (err) {
		console.error('[purchaseLabel] Failed to parse Shippo transaction response:', transactionText);
		throw new Error('Invalid JSON response from Shippo transaction endpoint.');
	}

	if (transaction.status === 'QUEUED' && transaction.object_id) {
		transaction = await pollTransaction(transaction.object_id);
	}

	if (!transaction.label_url || transaction.status === 'ERROR') {
		const message = extractShippoError(transaction) || 'Unknown error purchasing label.';
		console.error('[purchaseLabel] Label purchase error:', message, 'Transaction:', transaction);
		throw new Error(message);
	}

	const shippingCost = parseFloat(transaction.amount ?? transaction.rate?.amount ?? rateMeta?.amount ?? rateMeta?.amount_local ?? '0');
	const trackingNumber = transaction.tracking_number || transaction.tracking_code || transaction.rate?.tracking_number || transaction.rate?.tracking_code || null;
	const carrier = transaction.rate?.provider || transaction.rate?.carrier || rateMeta?.provider || rateMeta?.carrier || null;

	return {
		labelUrl: transaction.label_url,
		shippingCost: Number.isFinite(shippingCost) ? shippingCost : null,
		trackingNumber: trackingNumber || null,
		carrier
	};
}

async function pollTransaction(objectId) {
	const fetch = await getFetch();
	const pollUrl = `https://api.goshippo.com/transactions/${objectId}`;
	const maxPolls = 10;
	const pollDelay = 2000;
	let lastTransaction = null;
	for (let attempt = 0; attempt < maxPolls; attempt++) {
		await new Promise(res => setTimeout(res, pollDelay));
		const resp = await fetch(pollUrl, {
			method: 'GET',
			headers: {
				'Authorization': `ShippoToken ${SHIPPO_API_KEY}`,
				'Content-Type': 'application/json'
			}
		});
		const text = await resp.text();
		try {
			lastTransaction = JSON.parse(text);
		} catch (err) {
			console.error('[pollTransaction] Failed to parse poll response:', text);
			throw new Error('Failed to parse Shippo transaction poll response.');
		}
		if (lastTransaction.status === 'SUCCESS' && lastTransaction.label_url) {
			return lastTransaction;
		}
		if (lastTransaction.status === 'ERROR') {
			console.error('[pollTransaction] Transaction error:', extractShippoError(lastTransaction));
			throw new Error(extractShippoError(lastTransaction) || 'Shippo transaction returned error status.');
		}
	}
	console.warn('[pollTransaction] Max polls reached for transaction:', objectId, 'Last status:', lastTransaction?.status);
	return lastTransaction || {};
}

function extractShippoError(transaction) {
	if (!transaction) return null;
	if (Array.isArray(transaction.messages) && transaction.messages.length) {
		return transaction.messages.map(m => m?.text || '').filter(Boolean).join('; ');
	}
	return transaction.detail || transaction.message || transaction.error || null;
}

async function upsertOrderHistory({ supabase, orderData, packages, labelInfo, rateMeta }) {
	const items = normalizeJsonField(orderData?.Items);
	const customer = normalizeJsonField(orderData?.Customer);
	const userIds = normalizeUserIds(orderData?.UserID);
	const boxSkus = packages
		.map(pkg => (pkg?.boxSku || pkg?.boxsku || '').trim())
		.filter(Boolean);
	const shippingCost = Number.isFinite(labelInfo.shippingCost) ? labelInfo.shippingCost : (parseFloat(rateMeta?.amount) || parseFloat(rateMeta?.amount_local) || null);

	const historyPayload = {
		OrderID: orderData?.OrderID ?? orderData?.OrderNumber ?? orderData?.orderId ?? orderData?.orderID,
		Retailer: orderData?.Retailer || orderData?.shop || null,
		Platform: orderData?.Platform || orderData?.platform || null,
		Items: items || null,
		Customer: customer || null,
		Link: orderData?.Link || orderData?.link || null,
		BoxSkus: boxSkus.length ? boxSkus : null,
		ShippingCost: shippingCost !== null && !Number.isNaN(shippingCost) ? shippingCost : null,
		Notes: orderData?.Notes || null,
		UserID: userIds,
		CustomerMessages: orderData?.CustomerMessages || null,
		TrackingNumber: labelInfo.trackingNumber || null,
		ShippedAt: new Date().toISOString()
	};

	const { error } = await supabase
		.from('Order History')
		.upsert(historyPayload, { onConflict: 'OrderID' });
	if (error) {
		console.error('[upsertOrderHistory] Supabase error:', error);
		throw new Error(error.message || 'Unknown error writing Order History');
	}
}

async function removeOrderFromActive({ supabase, orderId }) {
	const { error } = await supabase
		.from('Orders')
		.delete()
		.eq('OrderID', orderId);
	if (error) {
		console.error('[removeOrderFromActive] Supabase error:', error);
		throw new Error(error.message || 'Failed to remove order from active table');
	}
}

async function decrementBoxesInventory({ supabase, packages }) {
	if (!Array.isArray(packages) || !packages.length) return [];
	
	// Count packages by SKU
	const counts = {};
	for (const pkg of packages) {
		const sku = (pkg?.boxSku || pkg?.boxsku || '').trim();
		if (sku) {
			counts[sku] = (counts[sku] || 0) + 1;
		}
	}
	
	const entries = Object.entries(counts);
	if (!entries.length) return [];
	
	// Fetch all box quantities in parallel
	const boxResults = await Promise.allSettled(
		entries.map(([sku]) => 
			supabase
				.from('Boxes')
				.select('SKU, Quantity')
				.eq('SKU', sku)
				.single()
		)
	);
	
	// Build update operations
	const updates = [];
	const warnings = [];
	
	for (let i = 0; i < entries.length; i++) {
		const [sku, count] = entries[i];
		const result = boxResults[i];
		
		if (result.status === 'rejected' || result.value.error) {
			warnings.push(`Failed to load box ${sku}: ${result.reason?.message || result.value.error?.message || 'Unknown error'}`);
			continue;
		}
		
		const currentQty = Number(result.value.data?.Quantity) || 0;
		const newQty = currentQty - count;
		updates.push({ sku, newQty });
	}
	
	// Execute all updates in parallel
	const updateResults = await Promise.allSettled(
		updates.map(({ sku, newQty }) =>
			supabase
				.from('Boxes')
				.update({ Quantity: newQty })
				.eq('SKU', sku)
		)
	);
	
	// Collect update warnings
	for (let i = 0; i < updates.length; i++) {
		const result = updateResults[i];
		if (result.status === 'rejected' || result.value.error) {
			warnings.push(`Failed to update box ${updates[i].sku}: ${result.reason?.message || result.value.error?.message || 'Unknown error'}`);
		}
	}
	
	return warnings;
}

async function fulfillFaireOrder({ orderData, trackingNumber, carrier, shippingCost }) {
	if (!getTokenRow) {
		throw new Error('Faire token utility unavailable on server.');
	}
	if (!FAIRE_CLIENT_ID || !FAIRE_CLIENT_SECRET) {
		throw new Error('Faire client credentials are not configured.');
	}
	const userKey = orderData?.Retailer || orderData?.shop;
	if (!userKey) {
		throw new Error('Missing Faire retailer key for order.');
	}
	let tokenRow;
	try {
		tokenRow = await getTokenRow(userKey);
	} catch (err) {
		throw new Error(`Unable to retrieve Faire token: ${err?.message || err}`);
	}
	if (!tokenRow?.access_token) {
		throw new Error('No Faire access token available.');
	}

	const fetch = await getFetch();
	const shipments = [{
		order_id: orderData?.OrderID ?? orderData?.OrderNumber ?? orderData?.orderId,
		tracking_code: trackingNumber || 'UNKNOWN',
		carrier: carrier || 'UNKNOWN',
		maker_cost_cents: Number.isFinite(shippingCost) ? Math.round(shippingCost * 100) : 0
	}];

	const credentials = Buffer.from(`${FAIRE_CLIENT_ID}:${FAIRE_CLIENT_SECRET}`).toString('base64');
	const url = `https://www.faire.com/external-api/v2/orders/${shipments[0].order_id}/shipments`;
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'X-FAIRE-APP-CREDENTIALS': credentials,
			'X-FAIRE-OAUTH-ACCESS-TOKEN': tokenRow.access_token,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ shipments })
	});
	const text = await response.text();
	if (!response.ok) {
		console.error('[fulfillFaireOrder] Faire API error:', response.status, text);
		throw new Error(`Faire API error: ${text}`);
	}
	return text;
}

function isFaireOrder(orderData) {
	const platform = (orderData?.Platform || orderData?.platform || '').toLowerCase();
	return platform === 'faire';
}

function normalizeJsonField(value) {
	if (!value && value !== 0) return null;
	if (typeof value === 'object' && !Array.isArray(value)) return value;
	if (Array.isArray(value)) return value;
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (!trimmed) return null;
		try {
			return JSON.parse(trimmed);
		} catch (err) {
			console.warn('[shippo-batch-label] Failed to parse JSON field:', err?.message || err);
			return null;
		}
	}
	return null;
}

function normalizeUserIds(value) {
	if (!value && value !== 0) return null;
	if (Array.isArray(value)) return value;
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (!trimmed) return null;
		try {
			const parsed = JSON.parse(trimmed);
			if (Array.isArray(parsed)) {
				return parsed;
			}
		} catch (err) {
			// fall through, treat as single value
		}
		return [trimmed];
	}
	return [value];
}

