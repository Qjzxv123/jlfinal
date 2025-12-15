/**
 * Supabase JWT Authentication Utility for Netlify Functions
 * Verifies JWT tokens using Supabase's getClaims method
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ypvyrophqkfqwpefuigi.supabase.co';
const SUPABASE_ANON_KEY = "sb_publishable_XtDxMgVJe2Eotlem8MDL4Q_kxP4pbFc";
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
 * Verify JWT authentication using Supabase's getClaims method
 * This validates the token using Supabase's JWT verification
 * @param {Object} event - Netlify function event object
 * @returns {Promise<{error: Object|null, claims: Object|null, user: Object|null}>}
 */
async function verifyAuth(event) {
  const token = extractToken(event);

  if (!token) {
    return {
      error: {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing authentication token' })
      },
      claims: null,
      user: null
    };
  }

  try {
    // Create Supabase client with anon key
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // Verify the JWT token by getting claims
    const { data: rawClaims, error } = await supabase.auth.getClaims(token);
    const claims = rawClaims?.claims || rawClaims;

    if (error || !claims) {
      console.error('Token verification failed:', error?.message || 'No claims found');
      return {
        error: {
          statusCode: 401,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            error: 'Invalid or expired authentication token',
            details: error?.message 
          })
        },
        claims: null,
        user: null
      };
    }

    // Extract user information from claims
    const user = {
      id: claims.sub,
      email: claims.email,
      ...claims
    };

    // Token is valid, return claims and user data
    return {
      error: null,
      claims: claims,
      user: user
    };
  } catch (error) {
    console.error('Auth verification error:', error.message);
    return {
      error: {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          error: 'Authentication verification failed',
          details: error.message 
        })
      },
      claims: null,
      user: null
    };
  }
}

/**
 * Get authenticated user ID from verified claims
 * @param {Object} user - User object from verifyAuth
 * @returns {string|null} - User ID if available
 */
function getUserId(user) {
  return user?.id || user?.sub || null;
}

/**
 * Create a Supabase client with the authenticated user's token
 * @param {string} token - JWT token
 * @returns {Object} - Supabase client with user context
 */
function createAuthenticatedSupabaseClient(token) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  });
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
  getUserId,
  createAuthenticatedSupabaseClient,
  createServiceSupabaseClient,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_KEY
};
