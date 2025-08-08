const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY);
async function getTokenRow(userKey) {
  const { data, error } = await supabase
    .from('oauth_tokens')
    .select('*')
    .eq('user_key', userKey)
    .eq('platform', 'faire')
    .single();
  if (error || !data) throw new Error('No token found for user');
  return data;
}

// userKey = email, userId = id
async function saveTokenRow(userKey, tokenData) {
  // Accepts tokenData with UserID property (id)
  const { error } = await supabase
    .from('oauth_tokens')
    .upsert({
      user_key: userKey,
      UserID: tokenData.UserID || null,
      platform: 'faire',
      ...tokenData
    }, { onConflict: ['user_key', 'platform'] });
  if (error) throw error;
}

module.exports = {
  getTokenRow,
  saveTokenRow
};