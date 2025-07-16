const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  const authHeader = event.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');

  if (!token) {
    return {
      statusCode: 401,
      body: JSON.stringify({ isAdmin: false, error: 'No token provided' }),
    };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return {
      statusCode: 401,
      body: JSON.stringify({ isAdmin: false, error: 'Invalid token' }),
    };
  }

  const isAdmin = user.user_metadata && user.user_metadata.role === 'service_role';

  return {
    statusCode: 200,
    body: JSON.stringify({ isAdmin }),
  };
};