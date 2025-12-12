// Renders the admin sidebar as a React component. React and ReactDOM are loaded on demand.
(function () {
  const REACT_URL = 'https://unpkg.com/react@18/umd/react.production.min.js';
  const REACT_DOM_URL = 'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js';
  const AUTH_STORAGE_KEY = 'sb-ypvyrophqkfqwpefuigi-auth-token';

  const adminLinks = [
    { href: 'AdminDashboard.html', icon: 'cil-briefcase', label: 'Admin Dashboard' },
    { href: 'EmployeeDashboard.html', icon: 'cil-speedometer', label: 'Employee Dashboard' },
    { href: 'Calendar.html', icon: 'cil-calendar', label: 'Calendar' },
    { href: 'Orders.html', icon: 'cil-3d', label: 'Order Viewer' },
    { href: 'Analytics.html', icon: 'cil-bar-chart', label: 'Business Analytics' },
    { href: 'Checklist.html', icon: 'cil-check', label: 'Checklist' },
    { href: 'AmazonShipments.html', icon: 'cib-amazon', label: 'Amazon Shipments' },
    { href: 'WarehouseShipments.html', icon: 'cil-truck', label: 'Warehouse Shipments' },
    { href: 'Manufacturing.html', icon: 'cil-factory', label: 'Manufacturing Tracker' },
    { href: 'IncomingIngredients.html', icon: 'cil-truck', label: 'Incoming Ingredients' },
    { href: 'DatabaseViewer.html', icon: 'cil-find-in-page', label: 'Database Viewer' },
    { href: 'logs.html', icon: 'cil-history', label: 'Quantity Update Logs' },
    { href: 'InventoryScanner.html', icon: 'cil-center-focus', label: 'Scanner' },
    { href: 'AddNewItem.html', icon: 'cil-plus', label: 'Add/Update Item' },
    { href: 'Qrcode.html', icon: 'cil-qr-code', label: 'QR Code Generator' },
    { href: 'Quoting.html', icon: 'cil-money', label: 'Product Quoting' },
    { href: 'Invoice.html', icon: 'cil-dollar', label: 'Invoice Calculator' },
    { href: 'UserManagement.html', icon: 'cil-user', label: 'User Management' },
    { href: '/CustomerChecklist.html', icon: 'cil-exit-to-app', label: 'Exit Admin Portal' },
  ];

  function ensureReactLoaded() {
    if (window.React && window.ReactDOM) return Promise.resolve();

    return new Promise((resolve, reject) => {
      let loaded = 0;
      const required = 2;

      function handleLoad() {
        loaded += 1;
        if (loaded === required) resolve();
      }

      function handleError(err) {
        console.error('Failed to load React dependencies', err);
        reject(err);
      }

      if (!window.React) {
        const reactScript = document.createElement('script');
        reactScript.src = REACT_URL;
        reactScript.async = true;
        reactScript.onload = handleLoad;
        reactScript.onerror = handleError;
        document.head.appendChild(reactScript);
      } else {
        handleLoad();
      }

      if (!window.ReactDOM) {
        const reactDomScript = document.createElement('script');
        reactDomScript.src = REACT_DOM_URL;
        reactDomScript.async = true;
        reactDomScript.onload = handleLoad;
        reactDomScript.onerror = handleError;
        document.head.appendChild(reactDomScript);
      } else {
        handleLoad();
      }
    });
  }

  function getDisplayName() {
    try {
      const userStr = localStorage.getItem(AUTH_STORAGE_KEY);
      if (userStr) {
        const userObj = JSON.parse(userStr);
        const metadata = userObj?.user?.user_metadata;
        if (metadata?.display_name) return metadata.display_name;
      }
    } catch (e) {
      // ignore parsing errors
    }
    return 'User';
  }

  function getActivePage() {
    let page = window.location.pathname.split('/').pop() || 'index.html';
    if (page === '' || page === '/') page = 'index.html';
    return page;
  }

  function AdminSidebar() {
    const displayName = React.useMemo(getDisplayName, []);
    const activePage = React.useMemo(getActivePage, []);

    const handleSignOut = React.useCallback(
      (event) => {
        event.preventDefault();
        localStorage.removeItem(AUTH_STORAGE_KEY);
        window.location.href = '/Login.html';
      },
      []
    );

    const renderNavItem = (link) => {
      const isActive = activePage === (link.href.split('/').pop() || link.href);
      const className = `nav-item${isActive ? ' active' : ''}`;
      const children = [
        React.createElement('i', { className: link.icon, key: 'icon' }),
        React.createElement('span', { key: 'label' }, link.label),
      ];

      if (link.onClick) {
        return React.createElement('a', { key: link.href, href: '#', className, onClick: link.onClick }, children);
      }

      return React.createElement('a', { key: link.href, href: link.href, className }, children);
    };

    const navItems = adminLinks.map(renderNavItem);
    navItems.push(
      React.createElement(
        'a',
        {
          key: 'signout',
          href: '#',
          className: 'nav-item',
          onClick: handleSignOut,
        },
        [React.createElement('i', { className: 'cil-account-logout', key: 'icon' }), React.createElement('span', { key: 'label' }, 'Sign Out')]
      )
    );

    return React.createElement(
      'div',
      { className: 'sidebar' },
      React.createElement('div', { className: 'sidebar-header' }, React.createElement('h2', null, displayName)),
      React.createElement('nav', { className: 'sidebar-nav' }, navItems)
    );
  }

  function renderSidebar() {
    const mountNode = document.getElementById('sidebar');
    if (!mountNode) return;

    ensureReactLoaded()
      .then(() => {
        ReactDOM.createRoot(mountNode).render(React.createElement(AdminSidebar));
      })
      .catch((err) => {
        console.error('Unable to render admin sidebar', err);
      });
  }

  document.addEventListener('DOMContentLoaded', renderSidebar);
})();
