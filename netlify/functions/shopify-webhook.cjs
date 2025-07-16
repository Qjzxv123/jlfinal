// netlify/functions/shopify-webhook.cjs
const crypto = require('crypto');

exports.handler = async (event) => {
  const shopifySecret = process.env.SHOPIFY_API_SECRET;
  const hmacHeader = event.headers['x-shopify-hmac-sha256'];
  const topic = event.headers['x-shopify-topic'];
  const shopDomain = event.headers['x-shopify-shop-domain'];
  const body = event.body;

  // Verify HMAC signature
  const generatedHmac = crypto
    .createHmac('sha256', shopifySecret)
    .update(body, 'utf8')
    .digest('base64');

  if (generatedHmac !== hmacHeader) {
    console.error('Shopify webhook HMAC verification failed', { topic, shopDomain });
    return {
      statusCode: 401,
      body: 'Unauthorized: Invalid HMAC signature',
    };
  }

  // Parse webhook body
  let payload;
  try {
    payload = JSON.parse(body);
  } catch (e) {
    return {
      statusCode: 400,
      body: 'Invalid JSON',
    };
  }

  // Handle mandatory compliance webhooks
  if (topic === 'app/uninstalled') {
    // Clean up shop data, tokens, etc.
    console.log(`App uninstalled for shop: ${shopDomain}`);
    // ...delete from Supabase or other storage...
  }
  if (topic === 'shop/update') {
    // Handle shop updates if needed
    console.log(`Shop updated: ${shopDomain}`);
    // ...update shop info in Supabase or other storage...
  }

  // Respond 200 OK for all valid webhooks
  return {
    statusCode: 200,
    body: 'Webhook received',
  };
};
