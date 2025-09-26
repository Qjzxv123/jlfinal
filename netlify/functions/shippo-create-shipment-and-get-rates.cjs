// netlify/functions/shippo-create-shipment-and-get-rates.cjs
// Creates a Shippo shipment from provided order + parcels and returns the available rates (no label purchase).
// Request: POST JSON { order: {...}, parcels: [{ length,width,height,weight }] }
// Response: 200 { rates: [...], shipment_id } | 4xx/5xx { error: "..." }

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

exports.handler = async (event) => {
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
		return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body.' }) };
	}
		const { order, parcels } = payload;
	if (!order || !Array.isArray(parcels) || parcels.length === 0) {
		return { statusCode: 400, body: JSON.stringify({ error: 'Missing order or parcels array.' }) };
	}

	// Sanitize / map parcels -> Shippo format
	const parcelsArr = parcels
		.filter(p => p && p.length && p.width && p.height && p.weight)
		.map(p => ({
			length: Number(p.length),
			width: Number(p.width),
			height: Number(p.height),
			distance_unit: 'in',
			weight: Number(p.weight),
			mass_unit: 'oz'
		}));
	if (!parcelsArr.length) {
		return { statusCode: 400, body: JSON.stringify({ error: 'No valid parcels supplied.' }) };
	}

	// Order customer data may be nested differently; try a few shapes
	let customer = order.Customer || order.customer || {};
	if (typeof customer === 'string') {
		try { customer = JSON.parse(customer); } catch { customer = {}; }
	}

	const address_to = {
		name: customer.name || customer.Name || '',
		street1: customer.address1 || customer.Address1 || customer.address || '',
		street2: customer.address2 || customer.Address2 || '',
		city: customer.city || customer.City || '',
		state: customer.state || customer.State || '',
		zip: customer.zipCode || customer.zip || customer.postal_code || '',
		country: customer.country || customer.Country || 'US',
		phone: customer.phone || '',
		email: (customer.email || '').substring(0, 50)
	};

	const address_from = {
		name: 'J&L Naturals',
		street1: '125 N Commercial Dr #103',
		city: 'Mooresville',
		state: 'NC',
		zip: '28115',
		country: 'US',
		email: 'jenn@jnlnaturals.com'
	};

	const isInternational = address_to.country && !['US', 'UNITED STATES'].includes(String(address_to.country).toUpperCase());

	const shipmentPayload = {
		address_from,
		address_to,
		parcels: parcelsArr,
		extra: { bypass_address_validation: true }
	};
	const platform = ((order && (order.Platform || order.platform)) || '').toLowerCase();
	const orderObjectId = order && (order.ShippoOrderID || order.shippo_order_id || order.shippoOrderId);
	if (orderObjectId && platform !== 'faire') {
		shipmentPayload.order = orderObjectId;
	}

	if (isInternational) {
		let itemsRaw = order?.Items ?? order?.items ?? order?.products ?? [];
		if (typeof itemsRaw === 'string') {
			try { itemsRaw = JSON.parse(itemsRaw); } catch { itemsRaw = []; }
		}
		if (!Array.isArray(itemsRaw)) {
			itemsRaw = Object.values(itemsRaw || {});
		}
		const customsItems = [];
		(itemsRaw || []).forEach(it => {
			if (!it) return;
			const qty = Number(it.Quantity ?? it.quantity ?? it.qty ?? 1) || 1;
			const weightOz = Number(it.WeightOz ?? it.weight_oz ?? it.weightOz ?? 0);
			const netWeightLb = weightOz ? (weightOz / 16) : 0;
			const valueEach = Number(it.Value ?? it.value ?? it.Price ?? it.price ?? 5) || 5;
			const desc = (it.Name ?? it.name ?? it.description ?? 'Merchandise').toString().slice(0, 45) || 'Merchandise';
			customsItems.push({
				description: desc,
				quantity: qty,
				net_weight: netWeightLb ? Number(netWeightLb.toFixed(2)) : 0.1,
				mass_unit: 'lb',
				value_amount: Number((valueEach).toFixed(2)) || 5,
				value_currency: 'USD',
				origin_country: 'US',
				tariff_number: it.hs_code || it.HSCode || ''
			});
		});
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
			certify_signer: 'J&L Naturals',
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

	let shipmentRespRaw;
	try {
		const resp = await fetch('https://api.goshippo.com/shipments/', {
			method: 'POST',
			headers: {
				'Authorization': `ShippoToken ${SHIPPO_API_KEY}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(shipmentPayload)
		});
		shipmentRespRaw = await resp.text();
		let shipment;
		try { shipment = JSON.parse(shipmentRespRaw); } catch (e) {
			return { statusCode: 500, body: JSON.stringify({ error: 'Unable to parse Shippo shipment response.' }) };
		}
		if (!resp.ok || !shipment || !shipment.object_id) {
			return { statusCode: resp.status || 500, body: JSON.stringify({ error: 'Error creating shipment', detail: shipment }) };
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
		return { statusCode: 500, body: JSON.stringify({ error: 'Exception creating shipment', message: err.message, raw: shipmentRespRaw }) };
	}
};

