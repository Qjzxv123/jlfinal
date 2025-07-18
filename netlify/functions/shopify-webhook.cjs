// netlify/functions/shopify-webhook.cjs
const crypto = require('crypto');

exports.handler = async (event) => {
  try {
    const shopifySecret = process.env.SHOPIFY_API_SECRET;
    const hmacHeader = event.headers['x-shopify-hmac-sha256'];
    const topic = event.headers['x-shopify-topic'];
    const shopDomain = event.headers['x-shopify-shop-domain'];
    const body = event.body;

    // Supabase client for token management
    const supabase = require('./supabase-client.cjs');

    if (!shopifySecret) {
      console.error('Missing SHOPIFY_API_SECRET environment variable');
      return {
        statusCode: 401,
        body: 'Unauthorized: Missing Shopify secret',
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
      // Always return 401 for HMAC errors
      return {
        statusCode: 401,
        body: 'Unauthorized: HMAC generation error',
      };
    }

    // Use timingSafeEqual for HMAC comparison
    try {
      const hmacBuffer = Buffer.from(hmacHeader, 'base64');
      const generatedBuffer = Buffer.from(generatedHmac, 'base64');
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
      // Delete shop token from Supabase
      try {
        await supabase.from('shopify_tokens').delete().eq('shop', shopDomain);
        console.log(`Deleted token for shop: ${shopDomain}`);
      } catch (err) {
        console.error('Error deleting token from Supabase:', err);
      }
    }
    // Save token on install (if token is present in payload)
    if (topic === 'app/installed' || (topic === 'shop/update' && payload.access_token)) {
      // Save shop and access token to Supabase
      try {
        await supabase.from('shopify_tokens').upsert({ shop: shopDomain, access_token: payload.access_token });
        console.log(`Saved token for shop: ${shopDomain}`);
      } catch (err) {
        console.error('Error saving token to Supabase:', err);
      }
    }
    if (topic === 'shop/update') {
      // Handle shop updates if needed
      console.log(`Shop updated: ${shopDomain}`);
      // Optionally update shop info in Supabase
      // await supabase.from('shopify_tokens').update({ ...fields }).eq('shop', shopDomain);
    }

    // Respond 200 OK for all valid webhooks
    return {
      statusCode: 200,
      body: 'Webhook received',
    };
  } catch (err) {
    // Catch any unexpected errors and return 401 for compliance
    console.error('Top-level unexpected error in webhook handler:', err);
    return {
      statusCode: 401,
      body: 'Unauthorized: Unexpected error',
    };
  }
};
