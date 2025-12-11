const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid JSON' })
    };
  }

  const { user_key, platform, access_token, refresh_token, UserID, expires_at, ShopifyDomain } = body;
  
  if (!user_key || !platform || !access_token || !UserID) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing required fields: user_key, platform, access_token, UserID' })
    };
  }

  console.log(`Saving OAuth token for platform: ${platform}, user_key: ${user_key}, UserID: ${UserID}`);

  try {
    const { error } = await supabase
      .from('oauth_tokens')
      .upsert({
        user_key,
        platform,
        access_token,
        refresh_token: refresh_token || null,
        UserID,
        expires_at: expires_at || null,
        ShopifyDomain: ShopifyDomain || null
      }, { onConflict: ['user_key', 'platform'] });

    if (error) {
      console.error('Error saving OAuth token:', error);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to save OAuth token', details: error.message })
      };
    }

    console.log(`OAuth token saved successfully for ${platform} - ${user_key}`);
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, message: 'OAuth token saved successfully' })
    };

  } catch (err) {
    console.error('Unexpected error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error', details: err.message })
    };
  }
};
