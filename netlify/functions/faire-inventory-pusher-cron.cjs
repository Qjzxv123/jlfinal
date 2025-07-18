// netlify/functions/faire-inventory-pusher-cron.cjs
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

exports.handler = async function(event, context) {
  // Fetch Faire JNL access token from Supabase oauth_tokens table (like faire-get-orders-cron)
  const { createClient } = require('@supabase/supabase-js');
  const credentials = Buffer.from(`${process.env.FAIRE_CLIENT_ID}:${process.env.FAIRE_CLIENT_SECRET}`).toString('base64');
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);


  // Find the oauth token for JNL (user_key = 'JNL', provider = 'faire')
  const { data: tokenRow, error: tokenError } = await supabase
    .from('oauth_tokens')
    .select('access_token')
    .eq('user_key', 'JNL')
    .eq('platform', 'faire')
    .maybeSingle();
  if (tokenError || !tokenRow || !tokenRow.access_token) {
    return { statusCode: 500, body: 'Missing Faire JNL access token in oauth_tokens' };
  }
  const apiToken = tokenRow.access_token;


  // Example: set inventory quantity to 100 for SKU 'mr-reg'
  const sku = 'MR-REG';
  const inventoryPayload = {
    inventories: [
      {
        sku,
        on_hand_quantity: 99
      }
    ]
  };

  const resp = await fetch('https://www.faire.com/external-api/v2/product-inventory/by-skus', {
    method: 'PATCH',
    headers: {
      'X-FAIRE-APP-CREDENTIALS': credentials,
      'X-FAIRE-OAUTH-ACCESS-TOKEN': apiToken,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(inventoryPayload)
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to update inventory', details: data }) };
  }
  return { statusCode: 200, body: JSON.stringify({ message: 'Successfully updated inventory for mr-reg', data }) };
};
