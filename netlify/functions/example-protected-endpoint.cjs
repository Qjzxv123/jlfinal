/**
 * Example Netlify Function: Protected Endpoint with JWT Authentication
 * Shows how to use the supabase-auth utility for JWT verification
 */

const { verifyAuth, getUserId, createServiceSupabaseClient } = require('./lib/supabase-auth.cjs');

exports.handler = async (event, context) => {
  // Step 1: Verify JWT authentication
  const authError = await verifyAuth(event);
  if (authError) {
    return authError; // Returns 401 if token is missing or invalid
  }

  // Step 2: Get authenticated user ID
  const userId = getUserId(event);
  console.log(`Authenticated user ID: ${userId}`);

  // Step 3: Parse request body
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid JSON in request body' })
    };
  }

  // Step 4: Perform protected operation using Supabase
  try {
    const supabase = createServiceSupabaseClient();

    // Example: Fetch user data
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Database query failed', details: error.message })
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: 'Protected endpoint accessed successfully',
        userId,
        user: data
      })
    };
  } catch (error) {
    console.error('Function error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Internal server error', details: error.message })
    };
  }
};
