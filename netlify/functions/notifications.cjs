const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Email service configuration
const sendEmail = async (to, subject, content) => {
  try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: {
        user: "jnlnaturals@gmail.com",
        pass: process.env.SMTP_PASS
      }
    });

    const mailOptions = {
      from: `"J&L Naturals" <jnlnaturals@gmail.com>`,
      to,
      subject,
      text: content,
      html: content.replace(/\n/g, '<br>')
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent to ${to}: ${subject}`);
    
    return { success: true, messageId: info.messageId, response: info.response };
  } catch (error) {
    console.error(`❌ Email failed to ${to}: ${error.message}`);
    
    // Development fallbacks
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS || error.code === 'EAUTH') {
      console.log(`📧 [DEV] Would send to ${to}: ${subject}`);
      return { success: true, dev: true, devMessage: `Email would be sent to ${to}` };
    }
    
    return { success: false, error: error.message, to, subject };
  }
};

// Get user notification preferences
const getUserNotificationPreferences = async (userId) => {
  try {
    const { data: user, error } = await supabase
      .from('Users')
      .select('email, display_name, Notifications')
      .eq('id', userId)
      .single();

    if (error) throw error;

    return {
      email: user.email,
      displayName: user.display_name,
      preferences: user.Notifications || {}
    };
  } catch (error) {
    console.error('Error fetching user preferences:', error);
    return null;
  }
};

// Core notification sender
const sendNotificationToUser = async (userId, type, title, message, data = {}) => {
  try {
    const userPrefs = await getUserNotificationPreferences(userId);
    if (!userPrefs) {
      return { success: false, error: 'User not found' };
    }

    // Check if user wants this type of notification
    if (type === 'inventory_alert' && !userPrefs.preferences.inventoryAlerts) {
      return { 
        success: false, 
        skipped: true, 
        reason: 'User opted out of this notification type' 
      };
    }
    
    if (type === 'task_reminder' && !userPrefs.preferences.taskReminders) {
      return { 
        success: false, 
        skipped: true, 
        reason: 'User opted out of this notification type' 
      };
    }

    // Send email notification
    if (userPrefs.email) {
      const emailResult = await sendEmail(
        userPrefs.email,
        title,
        `Hello ${userPrefs.displayName || 'there'},\n\n${message}\n\nBest regards,\nJ&L Naturals Team`
      );
      
      return {
        success: emailResult.success,
        channel: 'email',
        ...emailResult
      };
    }

    return { success: false, error: 'No email address found for user' };

  } catch (error) {
    console.error('Error sending notification to user:', error);
    return { success: false, error: error.message };
  }
};

// Helper function to filter items by user
const filterItemsByUser = (items, userId) => {
  return items.filter(item => 
    item.UserID && Array.isArray(item.UserID) && item.UserID.includes(userId)
  );
};

// Helper function to build inventory alert message
const buildInventoryAlertMessage = (criticalItems, lowItems) => {
  let message = '';
  let alertData = {
    criticalItems: criticalItems.length,
    lowItems: lowItems.length,
    items: []
  };

  if (criticalItems.length > 0) {
    message += `⚠️ CRITICAL: ${criticalItems.length} item(s) out of stock:\n`;
    criticalItems.forEach(item => {
      const displayName = item.Name || item.ProductSKU;
      message += `• ${displayName} (${item.Quantity || 0} units)\n`;
      alertData.items.push({
        sku: item.ProductSKU,
        name: item.Name,
        quantity: item.Quantity || 0,
        type: 'critical'
      });
    });
    message += '\n';
  }

  if (lowItems.length > 0) {
    message += `⚡ LOW STOCK: ${lowItems.length} item(s) below 20 units:\n`;
    lowItems.forEach(item => {
      const displayName = item.Name || item.ProductSKU;
      message += `• ${displayName} (${item.Quantity || 0} units)\n`;
      alertData.items.push({
        sku: item.ProductSKU,
        name: item.Name,
        quantity: item.Quantity || 0,
        type: 'low'
      });
    });
  }

  message += '\nPlease review inventory levels and restock as needed.';
  
  return { message, alertData };
};

// Check inventory levels and send alerts
const checkInventoryAlerts = async (users, inventoryData) => {
  try {
    // Filter items that need alerts
    const criticalItems = inventoryData.filter(item => (item.Quantity || 0) <= 0);
    const lowItems = inventoryData.filter(item => {
      const stock = item.Quantity || 0;
      return stock > 0 && stock < 20;
    });

    if (criticalItems.length === 0 && lowItems.length === 0) {
      console.log('📦 No inventory alerts needed');
      return { success: true, emailsSent: 0 };
    }

    let emailsSent = 0;

    // Send alerts to each user for their items
    for (const user of users) {
      // Check if user has explicitly enabled inventory alerts
      if (!user.Notifications?.inventoryAlerts) continue;

      const userCriticalItems = filterItemsByUser(criticalItems, user.id);
      const userLowItems = filterItemsByUser(lowItems, user.id);

      if (userCriticalItems.length === 0 && userLowItems.length === 0) {
        continue;
      }

      const { message } = buildInventoryAlertMessage(userCriticalItems, userLowItems);

      // Send email directly
      if (user.email) {
        const emailResult = await sendEmail(
          user.email,
          'Inventory Alert - Action Required',
          `Hello ${user.display_name || 'there'},\n\n${message}\n\nBest regards,\nJ&L Naturals Team`
        );
        
        if (emailResult.success) {
          emailsSent++;
        }
      }
    }

    console.log(`📊 Inventory Alerts: ${emailsSent} sent`);
    return { success: true, emailsSent };

  } catch (error) {
    console.error('Error checking inventory alerts:', error);
    return { success: false, error: error.message };
  }
};

// Helper function to build task reminder message
const buildTaskReminderMessage = (overdueTasks, dueSoonTasks) => {
  let message = '';
  
  if (overdueTasks.length > 0) {
    message += `⚠️ OVERDUE TASKS (${overdueTasks.length}):\n`;
    overdueTasks.forEach(task => {
      const deadline = new Date(task.Deadline).toLocaleDateString();
      message += `• ${task.Task} (Due: ${deadline})\n`;
    });
    message += '\n';
  }

  if (dueSoonTasks.length > 0) {
    message += `📅 DUE SOON (${dueSoonTasks.length}):\n`;
    dueSoonTasks.forEach(task => {
      const deadline = new Date(task.Deadline).toLocaleDateString();
      message += `• ${task.Task} (Due: ${deadline})\n`;
    });
  }

  message += '\nPlease review and complete these tasks as soon as possible.';
  
  return message;
};

// Check for task reminders
const checkTaskReminders = async (users, tasksData) => {
  try {
    if (!tasksData || tasksData.length === 0) {
      console.log('📋 No task reminders needed');
      return { success: true, emailsSent: 0 };
    }

    let emailsSent = 0;
    const processedUsers = new Set();
    const now = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Process each user only once
    for (const user of users) {
      // Check if user has explicitly enabled task reminders
      if (!user.Notifications?.taskReminders) continue;
      if (processedUsers.has(user.id)) continue;
      processedUsers.add(user.id);

      // Get all tasks for this user
      const userTasks = tasksData.filter(task => 
        task.UserID && Array.isArray(task.UserID) && task.UserID.includes(user.id)
      );

      if (userTasks.length === 0) continue;

      // Categorize tasks
      const overdueTasks = userTasks.filter(t => t.Deadline && new Date(t.Deadline) < now);
      const dueSoonTasks = userTasks.filter(t => {
        if (!t.Deadline) return false;
        const deadline = new Date(t.Deadline);
        return deadline >= now && deadline <= tomorrow;
      });

      if (overdueTasks.length === 0 && dueSoonTasks.length === 0) continue;

      const message = buildTaskReminderMessage(overdueTasks, dueSoonTasks);
      
      // Send email directly
      if (user.email) {
        const emailResult = await sendEmail(
          user.email,
          'Task Reminder - Action Required',
          `Hello ${user.display_name || 'there'},\n\n${message}\n\nBest regards,\nJ&L Naturals Team`
        );
        
        if (emailResult.success) {
          emailsSent++;
        }
      }
    }

    console.log(`📊 Task Reminders: ${emailsSent} sent`);
    return { success: true, emailsSent };

  } catch (error) {
    console.error('Error checking task reminders:', error);
    return { success: false, error: error.message };
  }
};

// Main handler
exports.handler = async (event, context) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
      },
      body: ''
    };
  }

  try {
    // 1. Get all users with email addresses and notification preferences
    const { data: users, error: usersError } = await supabase
      .from('Users')
      .select('id, email, display_name, Notifications')
      .not('email', 'is', null);

    if (usersError) throw usersError;

    // 2. Get inventory data
    const { data: inventoryData, error: inventoryError } = await supabase
      .from('Products')
      .select('ProductSKU, Name, Quantity, ReserveQuantity, UserID')
      .eq('Archived', false)
      .order('Quantity', { ascending: true });

    if (inventoryError) throw inventoryError;

    // 3. Get task data
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const { data: tasksData, error: tasksError } = await supabase
      .from('Checklist')
      .select('*')
      .eq('Status', 'Incomplete')
      .lte('Deadline', tomorrow.toISOString());

    if (tasksError) throw tasksError;

    // 4. Run notification checks with the data
    const [inventoryResult, taskResult] = await Promise.allSettled([
      checkInventoryAlerts(users, inventoryData),
      checkTaskReminders(users, tasksData)
    ]);

    const totalEmails = 
      (inventoryResult.status === 'fulfilled' ? inventoryResult.value.emailsSent || 0 : 0) +
      (taskResult.status === 'fulfilled' ? taskResult.value.emailsSent || 0 : 0);

    console.log(`✅ Notification checks completed - ${totalEmails} emails sent`);
    
    return {
      statusCode: 200,
      body: 'OK'
    };

  } catch (error) {
    console.error('❌ Notification handler error:', error);
    return {
      statusCode: 500,
      body: 'Error'
    };
  }
};

// Export additional functions for external use
module.exports = {
  handler: exports.handler,
  sendNotificationToUser,
  checkInventoryAlerts,
  checkTaskReminders
};
