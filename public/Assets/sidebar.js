// Injects the admin sidebar into the element with id 'sidebar'.
function renderAdminSidebar() {
  // Get user display name from correct localStorage key or fallback
  let displayName = 'User';
  try {
    const userStr = localStorage.getItem('sb-ypvyrophqkfqwpefuigi-auth-token');
    if (userStr) {
      const userObj = JSON.parse(userStr);
      if (userObj && userObj.user && userObj.user.user_metadata && userObj.user.user_metadata.display_name) {
        displayName = userObj.user.user_metadata.display_name;
      }
    }
  } catch (e) {
    // fallback to 'User'
  }
  const sidebarHTML = `
    <div class="sidebar-header">
      <h2>${displayName}</h2>
    </div>
    <nav class="sidebar-nav">
  <a href="AdminDashboard.html" class="nav-item"><i class="cil-briefcase"></i><span>Admin Dashboard</span></a>
  <a href="EmployeeDashboard.html" class="nav-item"><i class="cil-speedometer"></i><span>Employee Dashboard</span></a>
  <a href="OrderViewer.html" class="nav-item"><i class="cil-3d"></i><span>Order Viewer</span></a>
  <a href="Calendar.html" class="nav-item"><i class="cil-calendar"></i><span>Calendar</span></a>
  <a href="Checklist.html" class="nav-item"><i class="cil-check"></i><span>Checklist</span></a>
  <a href="AddFulfillmentLog.html" class="nav-item"><i class="cil-notes"></i><span>Add Fulfillment Log</span></a>
  <a href="AmazonShipments.html" class="nav-item"><i class="cib-amazon"></i><span>Amazon Shipments</span></a>
  <a href="WarehouseShipments.html" class="nav-item"><i class="cil-truck"></i><span>Warehouse Shipments</span></a>
  <a href="OrderTracker.html" class="nav-item"><i class="cil-factory"></i><span>Manufacturing Tracker</span></a>
  <a href="IncomingIngredients.html" class="nav-item"><i class="cil-truck"></i><span>Incoming Ingredients</span></a>
  <a href="DatabaseViewer.html" class="nav-item"><i class="cil-find-in-page"></i><span>Database Viewer</span></a>
  <a href="InventoryScanner.html" class="nav-item"><i class="cil-center-focus"></i><span>Scanner</span></a>
  <a href="AddItemAdmin.html" class="nav-item"><i class="cil-plus"></i><span>Add/Update Item</span></a>
  <a href="InventoryUpdater.html" class="nav-item"><i class="cil-chart"></i><span>Inventory Updater</span></a>
  <a href="Qrcode.html" class="nav-item"><i class="cil-qr-code"></i><span>QR Code Generator</span></a>
  <a href="Quoting.html" class="nav-item" id="sidebar-quoting"><i class="cil-money"></i><span>Product Quoting</span></a>
  <a href="Invoice.html" class="nav-item"><i class="cil-dollar"></i><span>Invoice Calculator</span></a>
  <a href="UserManagement.html" class="nav-item"><i class="cil-user"></i><span>User Management</span></a>
  <a href="/CustomerChecklist.html" class="nav-item"><i class="cil-exit-to-app"></i><span>Exit Admin Portal</span></a>
  <br><br>
  <a class="nav-item" id="sidebar-signout-btn"><i class="cil-account-logout"></i><span>Sign Out</span></a>
    </div>
  `;
  const sidebar = document.getElementById('sidebar');
  if (sidebar) {
    sidebar.className = 'sidebar';
    sidebar.innerHTML = sidebarHTML;
    // Highlight current page
    let page = window.location.pathname.split('/').pop() || 'index.html';
    // Also handle root path ("/" or "")
    if (page === '' || page === '/') page = 'index.html';
    const links = sidebar.querySelectorAll('.nav-item');
    links.forEach(link => {
      // Compare only the last part of the href (filename)
      const href = link.getAttribute('href');
      if (href && href.split('/').pop() === page) {
        link.classList.add('active');
      }
    });
    // Add sign out button handler
    const signOutBtn = document.getElementById('sidebar-signout-btn');
    if (signOutBtn) {
      signOutBtn.addEventListener('click', function() {
        // Remove Supabase auth token and redirect
        localStorage.removeItem('sb-ypvyrophqkfqwpefuigi-auth-token');
        window.location.href = '/Login.html';
      });
    }
  }
}

document.addEventListener('DOMContentLoaded', renderAdminSidebar);
