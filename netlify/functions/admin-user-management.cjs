// Netlify serverless function for admin user management (role changes and deletions)
const { createClient } = require('@supabase/supabase-js');
const { verifyAuth } = require('./lib/supabase-auth.cjs');

// Environment variables for security
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ypvyrophqkfqwpefuigi.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ALLOWED_ROLES = ['service_role'];
const PROTECTED_USER_ID = 'a4df0386-d361-4f54-a936-c9a2ea01e914';
exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  const authResult = await verifyAuth(event);
  if (authResult.error) return authResult.error;
  const role = authResult.claims?.role || authResult.claims?.user_metadata?.role || authResult.user?.role || authResult.user?.user_metadata?.role;
  console.log('[admin-user-management] requester role:', role, 'user id:', authResult.user?.id || authResult.claims?.sub);
  if (!ALLOWED_ROLES.includes(role)) {
    return {
      statusCode: 403,
      body: JSON.stringify({ error: 'Forbidden: insufficient role' })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid JSON' })
    };
  }

  const { action, userId, newRole } = body;
  if (!action || !userId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing required fields' })
    };
  }

  if (userId === PROTECTED_USER_ID) {
    return {
      statusCode: 403,
      body: JSON.stringify({ error: 'Forbidden: target user is protected' })
    };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    if (action === 'updateAllowedPages') {
      const { allowedPages } = body;
      if (!Array.isArray(allowedPages)) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'allowedPages must be an array' })
        };
      }
      // Update Users table
      const { error: tableError } = await supabase
        .from('Users')
        .update({ allowed_pages: allowedPages })
        .eq('id', userId);
      if (tableError) {
        return {
          statusCode: 500,
          body: JSON.stringify({ error: 'Error updating allowed_pages', details: tableError.message })
        };
      }
      // Also update user_metadata in Auth
      const { error: authError } = await supabase.auth.admin.updateUserById(userId, {
        user_metadata: { allowed_pages: allowedPages }
      });
      if (authError) {
        return {
          statusCode: 500,
          body: JSON.stringify({ error: 'Allowed pages updated in Users table, but error updating in Auth', details: authError.message })
        };
      }
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Allowed pages updated successfully' })
      };
    } else if (action === 'changeRole') {
      if (!newRole) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Missing newRole' })
        };
      }
      // Update role in Users table
      const { error: tableError } = await supabase
        .from('Users')
        .update({ "Role": newRole })
        .eq('id', userId);
      if (tableError) {
        return {
          statusCode: 500,
          body: JSON.stringify({ error: 'Error updating role in Users table', details: tableError.message })
        };
      }
      // Update role in Supabase Auth user_metadata
      const { error: authError } = await supabase.auth.admin.updateUserById(userId, {
        user_metadata: { role: newRole }
      });
      if (authError) {
        return {
          statusCode: 500,
          body: JSON.stringify({ error: 'Role updated in Users table, but error updating in Auth', details: authError.message })
        };
      }

      // Update the role column in auth.users
      // Use an RPC for security (requires a function in your DB)
      const { error: roleColError } = await supabase.rpc('set_auth_user_role', { user_id: userId, new_role: newRole });
      if (roleColError) {
        return {
          statusCode: 500,
          body: JSON.stringify({ error: 'Role updated in Users table and user_metadata, but error updating role column in auth.users', details: roleColError.message })
        };
      }

      // If making Admin, also set is_super_admin in auth.users
      if (newRole === 'service_role') {
        // Use RPC to update is_super_admin (requires RLS off or service role)
        const { error: superAdminError } = await supabase.rpc('set_is_super_admin', { user_id: userId, is_super: true });
        if (superAdminError) {
          return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Role updated, but error setting is_super_admin', details: superAdminError.message })
          };
        }
      } else {
        // If demoting from Admin, unset is_super_admin
        const { error: superAdminError } = await supabase.rpc('set_is_super_admin', { user_id: userId, is_super: false });
        if (superAdminError) {
          // Not fatal, but log
          console.error('Error unsetting is_super_admin:', superAdminError.message);
        }
      }
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Role updated successfully' })
      };
    } else if (action === 'deleteUser') {
      // Delete from Users table
      const { error: tableError } = await supabase
        .from('Users')
        .delete()
        .eq('id', userId);
      if (tableError) {
        return {
          statusCode: 500,
          body: JSON.stringify({ error: 'Error deleting user from Users table', details: tableError.message })
        };
      }
      // Delete from Supabase Auth
      const { error: authError } = await supabase.auth.admin.deleteUser(userId);
      if (authError) {
        return {
          statusCode: 500,
          body: JSON.stringify({ error: 'User deleted from Users table, but error deleting from Auth', details: authError.message })
        };
      }
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'User deleted successfully' })
      };
    } else {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid action' })
      };
    }
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server error', details: e.message })
    };
  }
};
