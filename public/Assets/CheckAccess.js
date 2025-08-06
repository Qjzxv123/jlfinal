// CheckAccess.js
// Shared access control and inactivity timeout logic for admin/customer pages
// Usage: import or include this file, then call checkPermissions() and setupInactivityTimeout()

// Supabase client initialization (edit these values as needed for your project)
const SUPABASE_URL = 'https://ypvyrophqkfqwpefuigi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlwdnlyb3BocWtmcXdwZWZ1aWdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgwMjQzMjAsImV4cCI6MjA2MzYwMDMyMH0.fDY3ZA-sVDoEK-_CgrgdjlUtVdH3YwULSAKjK9oFRbQ';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    session: { maxAge: 600 }
  }
});

/**
 * Checks if the current user has one of the allowed roles. Redirects or throws if not.
 * @param {string[]} allowedRoles - Array of allowed role strings (e.g., ['service_role', 'employee'])
 * @returns {Promise<object>} - Resolves with user object if allowed, otherwise redirects or throws
 */
async function checkPermissions(allowedRoles) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    // Always use relative Login.html for redirect
    window.location.href = '/Login.html?redirect=' + encodeURIComponent(window.location.pathname);
    return;
  }
  const { data: { user } } = await supabase.auth.getUser();
  const userRole = user?.user_metadata?.role;
  if (userRole === 'newuser') {
    window.location.href = 'PendingApproval.html';
    return;
  }
  if (!user || !userRole || !allowedRoles.includes(userRole)) {
    document.body.innerHTML = '<div style="margin:2rem;font-size:1.2rem;color:#e74c3c;text-align:center;">Access denied<br><br><a href="/index.html" style="color:#3498db;text-decoration:underline;font-size:1rem;">Return Home</a></div>';
    throw new Error('Access denied');
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
