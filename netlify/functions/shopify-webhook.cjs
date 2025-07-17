// netlify/functions/shopify-webhook.cjs
const crypto = require('crypto');

exports.handler = async (event) => {
  const shopifySecret = process.env.SHOPIFY_API_SECRET;
  const hmacHeader = event.headers['x-shopify-hmac-sha256'];
  const topic = event.headers['x-shopify-topic'];
  const shopDomain = event.headers['x-shopify-shop-domain'];
  const body = event.body;

  if (!shopifySecret) {
    console.error('Missing SHOPIFY_API_SECRET environment variable');
    return {
      statusCode: 500,
      body: 'Server misconfiguration: Missing Shopify secret',
    };
  }
  if (!hmacHeader) {
    console.error('Missing x-shopify-hmac-sha256 header');
    return {
      statusCode: 401,
      body: 'Unauthorized: Missing HMAC header',
    };
  }

  // Verify HMAC signature (use timingSafeEqual for security)
  let generatedHmac;
  try {
    generatedHmac = crypto
      .createHmac('sha256', shopifySecret)
      .update(body, 'utf8')
      .digest('base64');
  } catch (err) {
    console.error('Error generating HMAC:', err);
    return {
      statusCode: 500,
      body: 'Server error during HMAC verification',
    };
  }

  // Use timingSafeEqual for HMAC comparison
  try {
    const hmacBuffer = Buffer.from(hmacHeader, 'utf8');
    const generatedBuffer = Buffer.from(generatedHmac, 'utf8');
    if (
      hmacBuffer.length !== generatedBuffer.length ||
      !crypto.timingSafeEqual(hmacBuffer, generatedBuffer)
    ) {
      console.error('Shopify webhook HMAC verification failed', { topic, shopDomain });
      return {
        statusCode: 401,
        body: 'Unauthorized: Invalid HMAC signature',
      };
    }
  } catch (err) {
    // If timingSafeEqual throws, treat as unauthorized
    console.error('Error comparing HMAC:', err);
    return {
      statusCode: 401,
      body: 'Unauthorized: HMAC comparison error',
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
