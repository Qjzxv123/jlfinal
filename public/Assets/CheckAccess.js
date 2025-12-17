// CheckAccess.js
// Shared access control and inactivity timeout logic for admin/customer pages
// Usage: import or include this file, then call checkPermissions() and setupInactivityTimeout()

// Supabase client initialization (edit these values as needed for your project)
const SUPABASE_URL = 'https://ypvyrophqkfqwpefuigi.supabase.co';
const SUPABASE_KEY = 'sb_publishable_XtDxMgVJe2Eotlem8MDL4Q_kxP4pbFc';
// Create a single global Supabase client without redeclaring identifiers
// If the UMD library is loaded, it exposes window.supabase with createClient.
// We replace window.supabase with the client instance (only once) to avoid multiple globals.
(function initSupabaseClient() {
  try {
    if (!window.supabase) {
      console.error('Supabase library not loaded before CheckAccess.js');
      return;
    }
    // If supabase.auth exists, we already have a client. Otherwise create one.
    if (!window.supabase.auth) {
      window.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true,
          session: { maxAge: 600 }
        }
      });
    }
  } catch (e) {
    console.error('Failed to initialize Supabase client:', e);
  }
})();

// Global variables for current user info
var CurrentUserID = '';
var CurrentUserDisplayName = '';

/**
 * Checks if the current user has one of the allowed roles. Redirects or throws if not.
 * @param {string[]} allowedRoles - Array of allowed role strings (e.g., ['service_role', 'employee'])
 * @returns {Promise<object>} - Resolves with user object if allowed, otherwise redirects or throws
 */
async function checkPermissions(allowedRoles) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = '/Login.html?redirect=' + encodeURIComponent(window.location.pathname);
    return;
  }
  const { data: { user } } = await supabase.auth.getUser();
  window.user = user;
  // Set global user info
  CurrentUserID = user?.id || '';
  CurrentUserDisplayName = user?.user_metadata?.display_name || '';
  const userRole = user?.user_metadata?.role;
  if (!user || !userRole || !allowedRoles.includes(userRole)) {
    document.body.innerHTML = '<div style="margin:2rem;font-size:1.2rem;color:#e74c3c;text-align:center;">Access denied<br><br><a href="/index.html" style="color:#3498db;text-decoration:underline;font-size:1rem;">Return Home</a></div>';
    throw new Error('Access denied');
  }
  // Employee page access restriction
  if (userRole === 'employee') {
    const allowedPages = user.user_metadata?.allowed_pages || [];
    // Try to extract the page name from the pathname (e.g., /public/InventoryViewer.html => InventoryViewer)
    let page = window.location.pathname.split('/').pop() || '';
    page = page.replace('.html', '');
    // Always allow index.html
    const pageLower = page.toLowerCase();
    if (pageLower === 'index' || pageLower === 'employeedashboard'|| pageLower === 'customerchecklist') return user;
    const allowedPagesLower = allowedPages.map(p => p.toLowerCase());
    if (!allowedPagesLower.includes(pageLower)) {
      document.body.innerHTML = '<div style="margin:2rem;font-size:1.2rem;color:#e74c3c;text-align:center;">Access denied<br><br><a href="/index.html" style="color:#3498db;text-decoration:underline;font-size:1rem;">Return Home</a></div>';
      throw new Error('Access denied');
    }
  }

  return user;
}

/**
 * Sets up inactivity timeout: signs out and redirects after inactivity.
 * @param {number} timeoutMinutes - Minutes of inactivity before logout
 */
function setupInactivityTimeout(timeoutMinutes = 10) {
  const TIMEOUT_MS = timeoutMinutes * 60 * 1000;
  let inactivityTimer = null;
  function resetInactivityTimer() {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(async () => {
      await supabase.auth.signOut();
      alert('You have been signed out due to inactivity.');
      window.location.href = '/Login.html?redirect=' + encodeURIComponent(window.location.pathname);
    }, TIMEOUT_MS);
  }
  ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'].forEach(evt => {
    window.addEventListener(evt, resetInactivityTimer, true);
  });
  resetInactivityTimer();
}

// Export for module usage (if needed)
if (typeof module !== 'undefined') {
  module.exports = { checkPermissions, setupInactivityTimeout };
}
