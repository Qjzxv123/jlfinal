// netlify/functions/shippo-webhook.cjs
// Receives Shippo webhooks and logs the full request for diagnostics.
// URL: /.netlify/functions/shippo-webhook

exports.handler = async (event) => {
  try {
    const ts = new Date().toISOString();
    const method = event.httpMethod || 'UNKNOWN';
    const path = event.path || '';
    const headers = event.headers || {};
    const rawBody = event.body || '';

    // Netlify can Base64-encode the body for certain content types
    const bodyString = event.isBase64Encoded
      ? Buffer.from(rawBody, 'base64').toString('utf8')
      : rawBody;

    let parsed;
    try {
      parsed = JSON.parse(bodyString);
    } catch {
      parsed = null;
    }

    // Log with a clear prefix for filtering
    console.log('[shippo-webhook] Incoming request:', JSON.stringify({ ts, method, path }, null, 2));
    console.log('[shippo-webhook] Headers:', JSON.stringify(headers, null, 2));
    console.log('[shippo-webhook] Body (raw):', bodyString);
    if (parsed) {
      console.log('[shippo-webhook] Body (json):', JSON.stringify(parsed, null, 2));
    }

    // Optionally acknowledge immediately
    return {
      statusCode: 200,
      body: 'Webhook received'
    };
  } catch (err) {
    console.error('[shippo-webhook] Handler error:', err?.message || err);
    return {
      statusCode: 500,
      body: 'Internal Server Error'
    };
  }
};
