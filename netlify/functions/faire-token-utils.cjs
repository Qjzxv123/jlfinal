const supabase = require('./supabase-client.cjs');
const fetch = require('node-fetch');

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

async function saveTokenRow(userKey, tokenData) {
  const { error } = await supabase
    .from('oauth_tokens')
    .upsert({
      user_key: userKey,
      platform: 'faire',
      ...tokenData
    }, { onConflict: ['user_key', 'platform'] });
  if (error) throw error;
}

async function refreshToken(userKey, refreshToken) {
  // Only if you have a refresh token (Faire usually does not provide one)
  throw new Error('Faire does not support refresh tokens. Re-authenticate when expired.');
}

async function getValidToken(userKey) {
  const row = await getTokenRow(userKey);
  // Check if the token is still valid
  if (row.expires_at && row.expires_at > Date.now()) {
    return row.access_token;
  }
  if (row.refresh_token) {
    const newToken = await refreshToken(userKey, row.refresh_token);
    await saveTokenRow(userKey, newToken);
    return newToken.access_token;
  }
  throw new Error('Token expired and no refresh token available');
}

module.exports = {
  getValidToken,
  saveTokenRow
};