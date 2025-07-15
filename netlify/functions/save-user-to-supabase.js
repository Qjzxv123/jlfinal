// netlify/functions/save-user-to-supabase.js
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  const { user } = JSON.parse(event.body || '{}');
  if (!user) {
    return { statusCode: 400, body: 'Missing user data' };
  }
  // TODO: Replace with your Supabase URL and API key
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/users`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(user),
  });
  const data = await res.json();
  return {
    statusCode: res.status,
    body: JSON.stringify(data),
  };
};
