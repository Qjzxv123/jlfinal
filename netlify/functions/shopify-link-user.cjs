// netlify/functions/shopify-link-user.cjs
// Links a logged-in user to their Shopify store token

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Method not allowed'
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return {
      statusCode: 400,
      body: 'Invalid JSON body'
    };
  }

  const { shop, user_id, display_name } = body;

  if (!shop || !user_id || !display_name) {
    return {
      statusCode: 400,
      body: 'Missing required fields: shop, user_id, display_name'
    };
  }

  try {
    const supabase = require('./supabase-client.cjs');

    // First, create/update user in Users table
    try {
      const fetch = global.fetch || require('node-fetch');
      const addUserResponse = await fetch(`${process.env.URL || 'https://jlfinal.netlify.app'}/.netlify/functions/add-user-row`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: user_id,
          display_name: display_name,
          role: 'customer',
          email: display_name // Assuming display_name contains email
        })
      });
      
      if (addUserResponse.ok) {
        console.log(`Created/updated user: ${user_id} (${display_name})`);
      } else {
        console.error('Failed to create/update user:', await addUserResponse.text());
      }
    } catch (userErr) {
      console.error('Error creating/updating user:', userErr);
    }

    // Update the oauth_tokens table to link the shop to the user
    const { data, error } = await supabase
      .from('oauth_tokens')
      .update({ UserID: user_id })
      .eq('user_key', shop)
      .eq('platform', 'shopify');

    if (error) {
      console.error('Error linking Shopify store to user:', error);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: error.message })
      };
    }

    console.log(`Successfully linked Shopify store ${shop} to user ${user_id}`);

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        success: true, 
        message: `Shopify store ${shop} linked to user account` 
      })
    };

  } catch (error) {
    console.error('Error in shopify-link-user:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
