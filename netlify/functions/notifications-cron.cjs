const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);


// Email service configuration
const sendEmail = async (to, subject, textContent, htmlContent) => {
  try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
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
      html: htmlContent
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent to ${to}: ${subject}`);
    return { success: true, messageId: info.messageId, response: info.response };
  } catch (error) {
    console.error(`❌ Email failed to ${to}: ${error.message}`);
    return { success: false, error: error.message, to, subject };
  }
};

// Main Netlify handler
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

    // 2. Get inventory data (only products with Quantity < 20)
    const { data: inventoryData, error: inventoryError } = await supabase
      .from('Products')
      .select('ProductSKU, Name, Quantity, ReserveQuantity, UserID')
      .lt('Quantity', 20)
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

    // 4. Loop through users and send notifications (simple version)
    let emailsSent = 0;
    for (const user of users) {
      if (!user.email) continue;
      let htmlSections = [];
      let textSections = [];
      // Inventory alerts as HTML table
      if (user.Notifications && user.Notifications.inventoryAlerts) {
        const userProducts = inventoryData.filter(p => Array.isArray(p.UserID) ? p.UserID.includes(user.id) : p.UserID === user.id);
        if (userProducts.length > 0) {
          let html = `<h3 style='color:#d97706;'>Low Stock Products</h3><table border='1' cellpadding='6' cellspacing='0' style='border-collapse:collapse;margin-bottom:16px;width:100%;max-width:600px;'><thead style='background:#fef9c3;'><tr><th>SKU</th><th>Name</th><th>Quantity</th></tr></thead><tbody>`;
          let text = 'Low stock products:\n';
          for (const prod of userProducts) {
            html += `<tr><td>${prod.ProductSKU}</td><td>${prod.Name || prod.ProductSKU}</td><td style='color:#d97706;font-weight:bold;'>${prod.Quantity || 0}</td></tr>`;
            text += `- ${prod.Name || prod.ProductSKU}: ${prod.Quantity || 0} units\n`;
          }
          html += `</tbody></table>`;
          htmlSections.push(html);
          textSections.push(text);
        }
      }
      // Task reminders as HTML table
      if (user.Notifications && user.Notifications.taskReminders) {
        const userTasks = tasksData.filter(t => Array.isArray(t.UserID) ? t.UserID.includes(user.id) : t.UserID === user.id);
        if (userTasks.length > 0) {
          let html = `<h3 style='color:#4dba93;'>Tasks Due Soon</h3><table border='1' cellpadding='6' cellspacing='0' style='border-collapse:collapse;margin-bottom:16px;width:100%;max-width:600px;'><thead style='background:#e0f2fe;'><tr><th>Task</th><th>Deadline</th></tr></thead><tbody>`;
          let text = 'Tasks due soon:\n';
          for (const task of userTasks) {
            const deadline = task.Deadline ? new Date(task.Deadline).toLocaleDateString() : 'N/A';
            html += `<tr><td>${task.Task}</td><td>${deadline}</td></tr>`;
            text += `- ${task.Task} (Due: ${deadline})\n`;
          }
          html += `</tbody></table>`;
          htmlSections.push(html);
          textSections.push(text);
        }
      }
      if (htmlSections.length > 0) {
        const htmlContent = `<div style='font-family:Segoe UI,Tahoma,Geneva,Verdana,sans-serif;font-size:16px;color:#222;'><h2 style='color:#4dba93;'>J&amp;L Naturals Notifications</h2><p>Hello ${user.display_name || 'User'},</p>${htmlSections.join("<hr style='margin:24px 0;'>")}<p style='margin-top:32px;'>Best regards,<br>J&amp;L Naturals Team</p></div>`;
        await sendEmail(user.email, 'J&L Naturals Notifications', undefined, htmlContent);
        emailsSent++;
      }
    }
    return {
      statusCode: 200,
      body: `OK (${emailsSent} emails sent)`
    };
  } catch (error) {
    console.error('❌ Notification handler error:', error);
    return {
      statusCode: 500,
      body: 'Error'
    };
  }
};
