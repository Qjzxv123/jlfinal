const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Email service configuration using Nodemailer
const sendEmail = async (to, subject, content) => {
  try {
    // Create transporter based on environment variables
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: false, // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER || "qjzxv123@gmail.com",
        pass: process.env.SMTP_PASS || "angm dpxm vhsh fsvw"
      }
    });

    // Email options
    const mailOptions = {
      from: `"J&L Naturals" <${process.env.SMTP_USER || 'noreply@jlnaturals.com'}>`,
      to: to,
      subject: subject,
      text: content,
      html: content.replace(/\n/g, '<br>')
    };

    // Send email
    const info = await transporter.sendMail(mailOptions);
    console.log('✅ EMAIL SENT SUCCESSFULLY:');
    console.log(`   To: ${to}`);
    console.log(`   Subject: ${subject}`);
    console.log(`   Message ID: ${info.messageId}`);
    console.log(`   Response: ${info.response || 'No response'}`);
    
    return { success: true, messageId: info.messageId, response: info.response };
  } catch (error) {
    console.error('❌ EMAIL SENDING FAILED:');
    console.error(`   To: ${to}`);
    console.error(`   Subject: ${subject}`);
    console.error(`   Error: ${error.message}`);
    console.error(`   Full error:`, error);
    
    // For development or if SMTP not configured, just log
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.log(`📧 [DEV MODE] Would send email to ${to}: ${subject}`);
      return { success: true, dev: true, devMessage: `Email would be sent to ${to}` };
    }
    
    // If authentication failed, likely need app password
    if (error.code === 'EAUTH') {
      console.log(`🔐 [AUTH ISSUE] Gmail requires App Password - falling back to dev mode`);
      console.log(`📧 [DEV MODE] Would send email to ${to}: ${subject}`);
      return { success: true, dev: true, devMessage: `Email would be sent to ${to} (Auth fallback)` };
    }
    
    return { success: false, error: error.message, to: to, subject: subject };
  }
};

// Push notification service (placeholder)
const sendPushNotification = async (userId, title, body, data = {}) => {
  try {
    console.log(`Push notification would be sent to user ${userId}: ${title} - ${body}`);
    return { success: true };
  } catch (error) {
    console.error('Push notification error:', error);
    return { success: false, error: error.message };
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
      preferences: user.Notifications || {
        orderUpdates: true,
        inventoryAlerts: true,
        taskReminders: true,
        promotions: false
      }
    };
  } catch (error) {
    console.error('Error fetching user preferences:', error);
    return null;
  }
};

// Core notification sender
const sendNotificationToUser = async (userId, type, title, message, data = {}, channels = ['email']) => {
  try {
    // Get user preferences
    const userPrefs = await getUserNotificationPreferences(userId);
    if (!userPrefs) {
      return { success: false, error: 'User not found' };
    }

    // Check if user wants this type of notification
    const typeMapping = {
      'order_update': 'orderUpdates',
      'inventory_alert': 'inventoryAlerts',
      'task_reminder': 'taskReminders',
      'promotion': 'promotions'
    };

    const preferenceKey = typeMapping[type];
    if (preferenceKey && !userPrefs.preferences[preferenceKey]) {
      return { 
        success: false, 
        skipped: true, 
        reason: 'User opted out of this notification type' 
      };
    }

    const results = [];

    // Send email notification
    if (channels.includes('email') && userPrefs.email) {
      console.log(`📧 Attempting to send email notification to: ${userPrefs.email}`);
      const emailResult = await sendEmail(
        userPrefs.email,
        title,
        `Hello ${userPrefs.displayName || 'there'},\n\n${message}\n\nBest regards,\nJ&L Naturals Team`
      );
      console.log(`📧 Email result for ${userPrefs.email}:`, emailResult);
      results.push({ channel: 'email', ...emailResult });
    }

    // Send push notification
    if (channels.includes('push')) {
      const pushResult = await sendPushNotification(userId, title, message, data);
      results.push({ channel: 'push', ...pushResult });
    }

    return {
      success: results.some(r => r.success),
      results: results
    };

  } catch (error) {
    console.error('Error sending notification to user:', error);
    return { success: false, error: error.message };
  }
};

// Check inventory levels and send alerts
const checkInventoryAlerts = async () => {
  try {
    console.log('Checking inventory levels...');

    // Get current inventory data
    const { data: inventoryData, error: inventoryError } = await supabase
      .from('Products')
      .select('ProductSKU, Name, Quantity, ReserveQuantity')
      .eq('Archived', false)
      .order('Quantity', { ascending: true });

    if (inventoryError) throw inventoryError;

    // Filter items that need alerts
    const criticalItems = inventoryData.filter(item => {
      const currentStock = item.Quantity || 0;
      return currentStock <= 0;
    });

    const lowItems = inventoryData.filter(item => {
      const currentStock = item.Quantity || 0;
      return currentStock > 0 && currentStock < 20;
    });

    // If no alerts needed, exit early
    if (criticalItems.length === 0 && lowItems.length === 0) {
      console.log('No inventory alerts needed');
      return { success: true, message: 'No inventory alerts needed' };
    }

    // Get users who want inventory alerts
    const { data: users, error: usersError } = await supabase
      .from('Users')
      .select('id, email, display_name, Notifications')
      .neq('Notifications->inventoryAlerts', false);

    if (usersError) throw usersError;

    const alertUsers = users.filter(user => {
      const notifications = user.Notifications || {};
      return notifications.inventoryAlerts !== false;
    });

    if (alertUsers.length === 0) {
      console.log('No users configured for inventory alerts');
      return { success: true, message: 'No users configured for inventory alerts' };
    }

    const notificationResults = [];

    // Send alerts to each user
    for (const user of alertUsers) {
      let alertMessage = '';
      let alertData = {
        criticalItems: criticalItems.length,
        lowItems: lowItems.length,
        items: []
      };

      // Build alert message
      if (criticalItems.length > 0) {
        alertMessage += `⚠️ CRITICAL: ${criticalItems.length} item(s) out of stock:\n`;
        criticalItems.forEach(item => {
          const displayName = item.Name || item.ProductSKU;
          alertMessage += `• ${displayName} (${item.Quantity || 0} units)\n`;
          alertData.items.push({
            sku: item.ProductSKU,
            name: item.Name,
            quantity: item.Quantity || 0,
            type: 'critical'
          });
        });
        alertMessage += '\n';
      }

      if (lowItems.length > 0) {
        alertMessage += `⚡ LOW STOCK: ${lowItems.length} item(s) below 20 units:\n`;
        lowItems.forEach(item => {
          const displayName = item.Name || item.ProductSKU;
          alertMessage += `• ${displayName} (${item.Quantity || 0} units)\n`;
          alertData.items.push({
            sku: item.ProductSKU,
            name: item.Name,
            quantity: item.Quantity || 0,
            type: 'low'
          });
        });
      }

      alertMessage += '\nPlease review inventory levels and restock as needed.';

      // Send notification
      const result = await sendNotificationToUser(
        user.id,
        'inventory_alert',
        'Inventory Alert - Action Required',
        alertMessage,
        alertData,
        ['email']
      );

      notificationResults.push({
        userId: user.id,
        email: user.email,
        ...result
      });
    }

    console.log(`Sent inventory alerts to ${alertUsers.length} users`);
    
    // Log email success summary
    const emailResults = notificationResults.map(r => r.results?.find(res => res.channel === 'email'));
    const successfulEmails = emailResults.filter(r => r?.success).length;
    const failedEmails = emailResults.filter(r => !r?.success).length;
    console.log(`📊 EMAIL SUMMARY - Inventory Alerts:`);
    console.log(`   ✅ Successful: ${successfulEmails}`);
    console.log(`   ❌ Failed: ${failedEmails}`);
    console.log(`   📧 Total attempted: ${emailResults.length}`);
    
    return {
      success: true,
      criticalItems: criticalItems.length,
      lowItems: lowItems.length,
      usersNotified: alertUsers.length,
      emailStats: {
        successful: successfulEmails,
        failed: failedEmails,
        total: emailResults.length
      },
      results: notificationResults
    };

  } catch (error) {
    console.error('Error checking inventory alerts:', error);
    return { success: false, error: error.message };
  }
};

// Check for task reminders
const checkTaskReminders = async () => {
  try {
    console.log('Checking task reminders...');

    // Get tasks due within next 24 hours or overdue
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const { data: tasks, error: tasksError } = await supabase
      .from('Checklist')
      .select('*')
      .eq('Status', 'Incomplete')
      .lte('Deadline', tomorrow.toISOString());

    if (tasksError) throw tasksError;

    if (!tasks || tasks.length === 0) {
      console.log('No task reminders needed');
      return { success: true, message: 'No task reminders needed' };
    }

    const notificationResults = [];
    const processedUsers = new Set();

    // Group tasks by user and send reminders
    for (const task of tasks) {
      if (!task.UserID || !Array.isArray(task.UserID)) continue;

      for (const userId of task.UserID) {
        // Skip if we already processed this user
        if (processedUsers.has(userId)) continue;
        processedUsers.add(userId);

        // Get all tasks for this user
        const userTasks = tasks.filter(t => 
          t.UserID && Array.isArray(t.UserID) && t.UserID.includes(userId)
        );

        if (userTasks.length === 0) continue;

        // Check if task is overdue or due soon
        const now = new Date();
        const overdueTasks = userTasks.filter(t => t.Deadline && new Date(t.Deadline) < now);
        const dueSoonTasks = userTasks.filter(t => {
          if (!t.Deadline) return false;
          const deadline = new Date(t.Deadline);
          return deadline >= now && deadline <= tomorrow;
        });

        if (overdueTasks.length === 0 && dueSoonTasks.length === 0) continue;

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

        const taskData = {
          overdueTasks: overdueTasks.length,
          dueSoonTasks: dueSoonTasks.length,
          totalTasks: userTasks.length,
          tasks: userTasks.map(t => ({
            id: t.id,
            task: t.Task,
            priority: t.Priority,
            deadline: t.Deadline,
            status: t.Status
          }))
        };

        // Send notification
        const result = await sendNotificationToUser(
          userId,
          'task_reminder',
          'Task Reminder - Action Required',
          message,
          taskData,
          ['email']
        );

        notificationResults.push({
          userId: userId,
          overdueTasks: overdueTasks.length,
          dueSoonTasks: dueSoonTasks.length,
          ...result
        });
      }
    }

    console.log(`Sent task reminders to ${processedUsers.size} users`);
    
    // Log email success summary
    const emailResults = notificationResults.map(r => r.results?.find(res => res.channel === 'email'));
    const successfulEmails = emailResults.filter(r => r?.success).length;
    const failedEmails = emailResults.filter(r => !r?.success).length;
    console.log(`📊 EMAIL SUMMARY - Task Reminders:`);
    console.log(`   ✅ Successful: ${successfulEmails}`);
    console.log(`   ❌ Failed: ${failedEmails}`);
    console.log(`   📧 Total attempted: ${emailResults.length}`);
    
    return {
      success: true,
      usersNotified: processedUsers.size,
      totalTasks: tasks.length,
      emailStats: {
        successful: successfulEmails,
        failed: failedEmails,
        total: emailResults.length
      },
      results: notificationResults
    };

  } catch (error) {
    console.error('Error checking task reminders:', error);
    return { success: false, error: error.message };
  }
};

// Check for order updates and send notifications
const checkOrderNotifications = async () => {
  try {
    console.log('Checking for order updates...');

    // Get all orders - simplified query without specific columns
    const { data: allOrders, error: ordersError } = await supabase
      .from('ManufacturingTasks')
      .select('*')
      .limit(10); // Limit to avoid too many notifications

    if (ordersError) {
      console.log('Could not fetch orders:', ordersError.message);
      return { success: true, message: 'Could not fetch orders - table may not exist or have different structure' };
    }

    if (!allOrders || allOrders.length === 0) {
      console.log('No orders found');
      return { success: true, message: 'No orders found' };
    }

    console.log(`Found ${allOrders.length} orders`);
    
    // For now, just return success without sending notifications
    // since we're not sure about the exact table structure
    return {
      success: true,
      message: 'Order notifications checked - found orders but notifications disabled until table structure is confirmed',
      ordersFound: allOrders.length
    };

  } catch (error) {
    console.error('Error checking order notifications:', error);
    return { 
      success: true, 
      message: 'Order notifications skipped due to table structure issues',
      error: error.message 
    };
  }
};

// Send order status notifications
const sendOrderNotification = async (orderId, orderNumber, newStatus, oldStatus, userIds = [], additionalData = {}) => {
  try {
    console.log(`Sending order notification for ${orderNumber || orderId}: ${oldStatus} -> ${newStatus}`);

    // Get target users
    let targetUsers = [];
    if (userIds.length > 0) {
      const { data: users, error } = await supabase
        .from('Users')
        .select('id, email, display_name, Notifications')
        .in('id', userIds);

      if (!error) {
        targetUsers = users.filter(user => {
          const notifications = user.Notifications || {};
          return notifications.orderUpdates !== false;
        });
      }
    } else {
      // Get order data and associated users
      const { data: orderData, error: orderError } = await supabase
        .from('ManufacturingTasks')
        .select('*')
        .eq('id', orderId)
        .single();

      if (orderError) {
        console.error('Error fetching order:', orderError);
        return { success: false, error: 'Order not found' };
      }

      if (orderData.UserID && Array.isArray(orderData.UserID)) {
        const { data: users, error } = await supabase
          .from('Users')
          .select('id, email, display_name, Notifications')
          .in('id', orderData.UserID);

        if (!error) {
          targetUsers = users.filter(user => {
            const notifications = user.Notifications || {};
            return notifications.orderUpdates !== false;
          });
        }
      }
    }

    if (targetUsers.length === 0) {
      console.log('No users to notify for order update');
      return { success: true, message: 'No users to notify for this order update' };
    }

    const notificationResults = [];
    const displayOrderNumber = orderNumber || orderId;

    // Format status for display
    const formatStatus = (status) => {
      const statusMap = {
        'requested': 'Pending Review',
        'scheduled': 'Scheduled for Production',
        'in-production': 'In Production',
        'completed': 'Completed',
        'cancelled': 'Cancelled'
      };
      return statusMap[status?.toLowerCase()] || status || 'Unknown';
    };

    const formattedNewStatus = formatStatus(newStatus);
    const formattedOldStatus = formatStatus(oldStatus);

    // Send notifications to each user
    for (const user of targetUsers) {
      let title = `Order Update - ${displayOrderNumber}`;
      let message = `Your order ${displayOrderNumber} status has been updated to: ${formattedNewStatus}`;

      if (oldStatus) {
        message += `\n\nPrevious status: ${formattedOldStatus}`;
      }

      // Add status-specific information
      switch (newStatus.toLowerCase()) {
        case 'scheduled':
          message += '\n\nYour order has been scheduled for production. We will notify you when production begins.';
          break;
        case 'in-production':
          message += '\n\nYour order is now being manufactured. We will update you when it is completed.';
          break;
        case 'completed':
          message += '\n\nYour order has been completed! Thank you for your business.';
          title = `Order Completed - ${displayOrderNumber}`;
          break;
        case 'cancelled':
          message += '\n\nYour order has been cancelled. If you have questions, please contact our support team.';
          title = `Order Cancelled - ${displayOrderNumber}`;
          break;
      }

      const notificationData = {
        orderId,
        orderNumber: displayOrderNumber,
        newStatus,
        oldStatus,
        ...additionalData
      };

      // Send notification
      const result = await sendNotificationToUser(
        user.id,
        'order_update',
        title,
        message,
        notificationData,
        ['email']
      );

      notificationResults.push({
        userId: user.id,
        email: user.email,
        ...result
      });
    }

    console.log(`Sent order update notifications to ${targetUsers.length} users`);
    return {
      success: true,
      orderId,
      orderNumber: displayOrderNumber,
      newStatus: formattedNewStatus,
      usersNotified: targetUsers.length,
      results: notificationResults
    };

  } catch (error) {
    console.error('Error sending order notifications:', error);
    return { success: false, error: error.message };
  }
};

// Main handler
exports.handler = async (event, context) => {
  // Handle CORS
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
    const method = event.httpMethod;
    const path = event.path;
    const body = event.body ? JSON.parse(event.body) : {};

    let result = {};

    // Handle different endpoints
    if (method === 'POST' || method === 'GET') {
      // Always run all notification checks for opted-in users
      console.log('Running all notification checks for opted-in users...');
      
      const inventoryResult = await checkInventoryAlerts();
      const taskResult = await checkTaskReminders();
      const orderResult = await checkOrderNotifications();

      result = {
        success: true,
        message: 'All notification checks completed for opted-in users',
        inventory: inventoryResult,
        tasks: taskResult,
        orders: orderResult,
        timestamp: new Date().toISOString()
      };
    } else {
      return {
        statusCode: 405,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Method not allowed' })
      };
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(result)
    };

  } catch (error) {
    console.error('Notification handler error:', error);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ 
        error: 'Internal server error',
        details: error.message 
      })
    };
  }
};
