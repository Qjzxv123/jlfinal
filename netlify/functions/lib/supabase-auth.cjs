/**
 * Supabase JWT Authentication Utility for Netlify Functions
 * Provides middleware for verifying Supabase JWT tokens in requests
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ypvyrophqkfqwpefuigi.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

/**
 * Extract JWT token from Authorization header or query parameter
 * @param {Object} event - Netlify function event object
 * @returns {string|null} - The JWT token if found, null otherwise
 */
function extractToken(event) {
  // Check Authorization header first (preferred method)
  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  // Fall back to query parameter (less secure, for fallback only)
  const queryParams = event.queryStringParameters || {};
  if (queryParams.token) {
    return queryParams.token;
  }

  return null;
}

/**
 * Decode JWT token payload without verification (for reading claims)
 * @param {string} token - The JWT token to decode
 * @returns {Object|null} - Decoded token payload, null if invalid format
 */
function decodeToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    return payload;
  } catch (error) {
    console.error('Token decode failed:', error.message);
    return null;
  }
}

/**
 * Verify JWT authentication by testing with Supabase client
 * This is the most reliable way to verify Supabase tokens
 * @param {Object} event - Netlify function event object
 * @returns {Object|null} - Error response if auth fails, null if auth succeeds
 */
async function verifyAuth(event) {
  const token = extractToken(event);

  if (!token) {
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing authentication token' })
    };
  }

  try {
    // Create a Supabase client with the user's token
    const supabase = createClient(SUPABASE_URL, token);

    // Verify the token by attempting to get the current user
    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
      console.error('Token verification failed:', error?.message || 'No user found');
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid or expired authentication token' })
      };
    }

    return null; // Auth successful
  } catch (error) {
    console.error('Auth verification error:', error.message);
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Authentication verification failed' })
    };
  }
}

/**
 * Get authenticated user ID from JWT token
 * Extracts the 'sub' claim without verifying the signature
 * @param {Object} event - Netlify function event object
 * @returns {string|null} - User ID if token exists, null otherwise
 */
function getUserId(event) {
  const token = extractToken(event);
  if (!token) return null;

  const decoded = decodeToken(token);
  return decoded?.sub || null; // 'sub' claim contains user ID in Supabase JWT
}

/**
 * Create a Supabase client with the authenticated user's token
 * @param {Object} event - Netlify function event object
 * @returns {Object|null} - Supabase client with user context if token exists, null otherwise
 */
function createAuthenticatedSupabaseClient(event) {
  const token = extractToken(event);
  if (!token) return null;

  // Create client with user's auth context
  return createClient(SUPABASE_URL, token);
}

/**
 * Create a Supabase client with service role privileges
 * Use this for elevated operations that require service key access
 * @returns {Object} - Supabase client with service key privileges
 */
function createServiceSupabaseClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

module.exports = {
  verifyAuth,
  extractToken,
  decodeToken,
  getUserId,
  createAuthenticatedSupabaseClient,
  createServiceSupabaseClient,
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY
};
