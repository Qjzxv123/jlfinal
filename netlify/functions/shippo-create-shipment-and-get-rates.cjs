// netlify/functions/shippo-create-shipment-and-get-rates.cjs
// Creates a Shippo shipment from provided order + parcels and returns the available rates (no label purchase).
// Request: POST JSON { order: {...}, parcels: [{ length,width,height,weight }] }
// Response: 200 { rates: [...], shipment_id } | 4xx/5xx { error: "..." }

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const FALLBACK_PHONE = '7045550000';
const SHIPPER_PHONE = '7045550000';

function sanitizePhoneNumber(rawValue, fallbackValue = FALLBACK_PHONE, minLength = 10) {
	const digits = String(rawValue || '').replace(/\D/g, '');
	if (digits.length >= minLength) {
		return digits.substring(0, 15);
	}
	const fallbackDigits = String(fallbackValue || '').replace(/\D/g, '');
	if (fallbackDigits.length >= minLength) {
		return fallbackDigits.substring(0, 15);
	}
	// Last resort: trimmed fallback phone constant
	return String(FALLBACK_PHONE).replace(/\D/g, '').substring(0, 15) || '7045550000';
}

function sanitizePostalCode(value) {
	if (value === undefined || value === null) return '';
	let trimmed = String(value).trim();
	if (!trimmed) return '';
	if (trimmed.length <= 11) return trimmed;
	const compact = trimmed.replace(/[^A-Za-z0-9]/g, '');
	if (compact.length > 0) {
		return compact.substring(0, Math.min(11, compact.length)).toUpperCase();
	}
	return trimmed.substring(0, 11);
}

function normalizeMilitaryAddress(address) {
	const city = (address.city || '').trim();
	const state = (address.state || '').trim();
	const normalizedCity = city.toUpperCase();
	const normalizedState = state.toUpperCase();
	if (['APO', 'FPO', 'DPO'].includes(normalizedCity) || ['AA', 'AE', 'AP'].includes(normalizedState)) {
		return {
			...address,
			city: normalizedCity || 'APO',
			state: normalizedState || 'AE',
			country: 'US'
		};
	}
	return address;
}

// Cache fetch module at cold start
let fetchModule;
const getFetch = async () => {
	if (!fetchModule) {
		fetchModule = await import('node-fetch');
	}
	return fetchModule.default;
};

exports.handler = async (event) => {
	// Early validation
	if (event.httpMethod !== 'POST') {
		return { statusCode: 405, body: 'Method Not Allowed' };
	}
	
	const SHIPPO_API_KEY = process.env.SHIPPO_API_KEY;
	if (!SHIPPO_API_KEY) {
		return { statusCode: 500, body: JSON.stringify({ error: 'Missing Shippo API token (env SHIPPO_API_KEY).' }) };
	}

	let payload;
	try {
		payload = JSON.parse(event.body || '{}');
	} catch (err) {
		console.error('[shippo-create-shipment-and-get-rates] JSON parse error:', err);
		return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body.' }) };
	}
	
	const { order, parcels } = payload;
	if (!order || !Array.isArray(parcels) || parcels.length === 0) {
		console.error('[shippo-create-shipment-and-get-rates] Missing order or parcels:', { hasOrder: !!order, parcelsLength: Array.isArray(parcels) ? parcels.length : 'not array' });
		return { statusCode: 400, body: JSON.stringify({ error: 'Missing order or parcels array.' }) };
	}

	// Get cached fetch
	const fetch = await getFetch();

	// Sanitize / map parcels -> Shippo format (optimized)
	const parcelsArr = [];
	for (const p of parcels) {
		if (p?.length && p?.width && p?.height && p?.weight) {
			parcelsArr.push({
				length: Number(p.length),
				width: Number(p.width),
				height: Number(p.height),
				distance_unit: 'in',
				weight: Number(p.weight),
				mass_unit: 'oz'
			});
		}
	}
	
	if (!parcelsArr.length) {
		console.error('[shippo-create-shipment-and-get-rates] No valid parcels after sanitization. Input parcels:', parcels);
		return { statusCode: 400, body: JSON.stringify({ error: 'No valid parcels supplied.' }) };
	}

	// Order customer data may be nested differently; try a few shapes
	let customer = order.Customer || order.customer || {};
	if (typeof customer === 'string') {
		try { customer = JSON.parse(customer); } catch { customer = {}; }
	}

	// Ensure phone is present and sanitized for UPS label requirements
	const rawPhone = customer.phone || customer.Phone || order?.CustomerPhone || order?.phone || '';

	let address_to = {
		name: customer.name || customer.Name || '',
		street1: customer.address1 || customer.Address1 || customer.address || '',
		street2: customer.address2 || customer.Address2 || '',
		city: customer.city || customer.City || '',
		state: customer.state || customer.State || '',
		zip: customer.zipCode || customer.zip || customer.postal_code || '',
		country: customer.country || customer.Country || 'US',
		phone: null,
		email: (customer.email || '').substring(0, 50)
	};
	address_to = normalizeMilitaryAddress(address_to);

	const address_from = {
		name: order?.retailer|| order?.Retailer || 'Some Retailer',
		street1: '125 N Commercial Dr #103',
		city: 'Mooresville',
		state: 'NC',
		zip: '28115',
		country: 'US',
		email: 'jenn@jnlnaturals.com',
		phone: sanitizePhoneNumber(SHIPPER_PHONE, FALLBACK_PHONE, 10)
	};

	const rawCountry = String(address_to.country || 'US').toUpperCase();
	const normalizedCountry = rawCountry === 'UNITED STATES' ? 'US' : rawCountry;
	address_to.country = normalizedCountry;
	const isInternational = normalizedCountry !== 'US';
	address_to.zip = sanitizePostalCode(address_to.zip);
	address_to.phone = sanitizePhoneNumber(rawPhone, FALLBACK_PHONE, isInternational ? 6 : 10);

	const shipmentPayload = {
		address_from,
		address_to,
		parcels: parcelsArr,
		extra: { bypass_address_validation: true }
	};
	
	const platform = String(order?.Platform || order?.platform || '').toLowerCase();
	const orderObjectId = order?.ShippoOrderID || order?.shippo_order_id || order?.shippoOrderId;
	
	if (orderObjectId && platform !== 'faire') {
		shipmentPayload.order = orderObjectId;
	}

	// Handle international shipments with customs
	if (isInternational) {
		let itemsRaw = order?.Items ?? order?.items ?? order?.products ?? [];
		if (typeof itemsRaw === 'string') {
			try { itemsRaw = JSON.parse(itemsRaw); } catch { itemsRaw = []; }
		}
		if (!Array.isArray(itemsRaw)) {
			itemsRaw = Object.values(itemsRaw || {});
		}
		
		const customsItems = [];
		for (const it of itemsRaw) {
			if (!it) continue;
			
			const qty = Number(it.Quantity ?? it.quantity ?? it.qty ?? 1) || 1;
			const weightOz = Number(it.WeightOz ?? it.weight_oz ?? it.weightOz ?? 0);
			const netWeightLb = weightOz ? (weightOz / 16) : 0;
			const valueEach = Number(it.Value ?? it.value ?? it.Price ?? it.price ?? 5) || 5;
			// UPS customs item description must be <= 30 chars
			const desc = (String(it.Name ?? it.name ?? it.description ?? 'Merchandise').substring(0, 30)) || 'Merchandise';
			
			customsItems.push({
				description: desc,
				quantity: qty,
				net_weight: netWeightLb ? Number(netWeightLb.toFixed(2)) : 0.1,
				mass_unit: 'lb',
				value_amount: Number(valueEach.toFixed(2)) || 5,
				value_currency: 'USD',
				origin_country: 'US',
				tariff_number: it.hs_code || it.HSCode || ''
			});
		}
		
		if (!customsItems.length) {
			customsItems.push({
				description: 'Merchandise',
				quantity: 1,
				net_weight: 0.1,
				mass_unit: 'lb',
				value_amount: 5,
				value_currency: 'USD',
				origin_country: 'US',
				tariff_number: ''
			});
		}
		
		const customsPayload = {
			certify: true,
			certify_signer: '3PL',
			contents_type: 'MERCHANDISE',
			eel_pfc: 'NOEEI_30_37_a',
			non_delivery_option: 'RETURN',
			items: customsItems
		};
		
		try {
			const customsResp = await fetch('https://api.goshippo.com/customs/declarations/', {
				method: 'POST',
				headers: {
					'Authorization': `ShippoToken ${SHIPPO_API_KEY}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(customsPayload)
			});
			
			const customsData = await customsResp.json();
			
			if (customsResp.ok && customsData?.object_id) {
				shipmentPayload.customs_declaration = customsData.object_id;
			} else {
				return { statusCode: 500, body: JSON.stringify({ error: 'Error creating customs declaration', detail: customsData }) };
			}
		} catch (err) {
			return { statusCode: 500, body: JSON.stringify({ error: 'Exception creating customs declaration', message: err.message }) };
		}
	}

	// Create shipment
	try {
		const resp = await fetch('https://api.goshippo.com/shipments/', {
			method: 'POST',
			headers: {
				'Authorization': `ShippoToken ${SHIPPO_API_KEY}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(shipmentPayload)
		});
		
		if (!resp.ok) {
			const errorText = await resp.text();
			let errorDetail;
			try { errorDetail = JSON.parse(errorText); } catch { errorDetail = errorText; }
			return { statusCode: resp.status, body: JSON.stringify({ error: 'Error creating shipment', detail: errorDetail }) };
		}
		
		const shipment = await resp.json();
		
		if (!shipment?.object_id) {
			return { statusCode: 500, body: JSON.stringify({ error: 'Invalid shipment response', detail: shipment }) };
		}
		
		const rates = shipment.rates || [];
		if (!rates.length) {
			return { statusCode: 502, body: JSON.stringify({ error: 'No rates returned from Shippo.' }) };
		}
		
		return {
			statusCode: 200,
			body: JSON.stringify({ rates, shipment_id: shipment.object_id })
		};
	} catch (err) {
		return { statusCode: 500, body: JSON.stringify({ error: 'Exception creating shipment', message: err.message }) };
	}
};

