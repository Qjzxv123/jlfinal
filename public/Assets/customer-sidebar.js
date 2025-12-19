// Determine if a holiday theme should be applied (with ?holidayPreview override).
function getSidebarHolidayMode() {
  const today = new Date();
  const month = today.getMonth() + 1; // 1-12
  if (month === 12) return 'christmas';
  return null;
}

// Injects the public (customer) sidebar into the element with id 'sidebar'.
function renderCustomerSidebar() {
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
      <a href="CustomerDashboard.html" class="nav-item"><i class="cil-speedometer"></i><span>Dashboard</span></a>
      <a href="ecommerce-oauth.html" class="nav-item"><i class="cil-basket"></i><span>Onboard Stores</span></a>
      <a href="InventoryViewer.html" class="nav-item"><i class="cil-storage"></i><span>Inventory Viewer</span></a>
      <a href="CustomerOrders.html" class="nav-item"><i class="cil-user"></i><span>Customer Orders</span></a>
      <a href="AddProduct.html" class="nav-item"><i class="cil-plus"></i><span>Add Product</span></a>
      <a href="SendtoAmazon.html" class="nav-item"><i class="cib-amazon"></i><span>Send To Amazon</span></a>
      <a href="SendtoWarehouse.html" class="nav-item"><i class="cil-truck"></i><span>Send To Warehouse</span></a>
      <a href="CustomerOrderView.html" class="nav-item"><i class="cil-bullhorn"></i><span>Order Requester</span></a>
      <a href="CustomerChecklist.html" class="nav-item"><i class="cil-check"></i><span>Checklist</span></a>
      <a href="CustomerAnalytics.html" class="nav-item"><i class="cil-chart-line"></i><span>Analytics</span></a>
      <a href="admin/Orders.html" class="nav-item"><i class="cil-shield-alt"></i><span>Admin Portal</span></a>
    </nav>
    <div id="sidebar-signout" style="position: absolute; bottom: 24px; left: 0; width: 100%; text-align: left;">
      <a href="privacy.html" class="nav-item" style="width:90%;margin:0 auto;"><i class="cil-lock-locked"></i><span>Privacy Policy</span></a>
      <a id="sign-out-btn" class="nav-item" style="width:90%;margin:0 auto;display:none;cursor:pointer;"><i class="cil-account-logout"></i><span>Sign Out</span></a>
    </div>
  `;
  const sidebar = document.getElementById('sidebar');
  if (sidebar) {
    sidebar.className = 'sidebar';
    sidebar.innerHTML = sidebarHTML;
    const holidayMode = getSidebarHolidayMode();
    if (holidayMode === 'christmas') {
      sidebar.classList.add('holiday-christmas');
    }
    // Highlight current page
    let page = window.location.pathname.split('/').pop() || 'index.html';
    if (page === '' || page === '/') page = 'index.html';
    const links = sidebar.querySelectorAll('.nav-item');
    links.forEach(link => {
      const href = link.getAttribute('href');
      if (href && href.split('/').pop() === page) {
        link.classList.add('active');
      }
    });
  }
}

// Initialize sidebar and sign-out functionality
document.addEventListener('DOMContentLoaded', function() {
  renderCustomerSidebar();
  
  // Set up sign-out button functionality
  setTimeout(() => {
    // Check if user is logged in by checking localStorage
    const userToken = localStorage.getItem('sb-ypvyrophqkfqwpefuigi-auth-token');
    const signOutBtn = document.getElementById('sign-out-btn');
    
    if (signOutBtn) {
      if (userToken) {
        signOutBtn.style.display = 'flex';
      } else {
        signOutBtn.style.display = 'none';
      }
      
      // Add click handler to clear localStorage and reload
      signOutBtn.addEventListener('click', function(e) {
        e.preventDefault();
        // Clear all auth-related localStorage items
        localStorage.removeItem('sb-ypvyrophqkfqwpefuigi-auth-token');
        // Reload page to reflect logged out state
        window.location.reload();
      });
    }
  }, 100);
});
