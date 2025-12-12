// Renders the customer sidebar as a React component. React and ReactDOM are loaded on demand.
(function () {
  const REACT_URL = 'https://unpkg.com/react@18/umd/react.production.min.js';
  const REACT_DOM_URL = 'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js';
  const AUTH_STORAGE_KEY = 'sb-ypvyrophqkfqwpefuigi-auth-token';

  const customerLinks = [
    { href: 'CustomerDashboard.html', icon: 'cil-speedometer', label: 'Dashboard' },
    { href: 'ecommerce-oauth.html', icon: 'cil-basket', label: 'Onboard Stores' },
    { href: 'InventoryViewer.html', icon: 'cil-storage', label: 'Inventory Viewer' },
    { href: 'CustomerOrders.html', icon: 'cil-user', label: 'Customer Orders' },
    { href: 'AddProduct.html', icon: 'cil-plus', label: 'Add Product' },
    { href: 'SendtoAmazon.html', icon: 'cib-amazon', label: 'Send To Amazon' },
    { href: 'SendtoWarehouse.html', icon: 'cil-truck', label: 'Send To Warehouse' },
    { href: 'CustomerOrderView.html', icon: 'cil-bullhorn', label: 'Order Requester' },
    { href: 'CustomerChecklist.html', icon: 'cil-check', label: 'Checklist' },
    { href: 'CustomerAnalytics.html', icon: 'cil-chart-line', label: 'Analytics' },
    { href: 'admin/Orders.html', icon: 'cil-shield-alt', label: 'Admin Portal' },
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

  function CustomerSidebar() {
    const displayName = React.useMemo(getDisplayName, []);
    const activePage = React.useMemo(getActivePage, []);
    const hasToken = React.useMemo(() => Boolean(localStorage.getItem(AUTH_STORAGE_KEY)), []);

    const renderNavItem = (link) => {
      const isActive = activePage === (link.href.split('/').pop() || link.href);
      const className = `nav-item${isActive ? ' active' : ''}`;
      return React.createElement(
        'a',
        { key: link.href, href: link.href, className },
        [
          React.createElement('i', { className: link.icon, key: 'icon' }),
          React.createElement('span', { key: 'label' }, link.label),
        ]
      );
    };

    const handleSignOut = React.useCallback((event) => {
      event.preventDefault();
      localStorage.removeItem(AUTH_STORAGE_KEY);
      window.location.reload();
    }, []);

    const footerLinks = [
      React.createElement(
        'a',
        {
          key: 'privacy',
          href: 'privacy.html',
          className: 'nav-item',
          style: { width: '90%', margin: '0 auto' },
        },
        [React.createElement('i', { className: 'cil-lock-locked', key: 'icon' }), React.createElement('span', { key: 'label' }, 'Privacy Policy')]
      ),
    ];

    if (hasToken) {
      footerLinks.push(
        React.createElement(
          'a',
          {
            key: 'signout',
            href: '#',
            className: 'nav-item',
            style: { width: '90%', margin: '0 auto', display: 'flex', cursor: 'pointer' },
            onClick: handleSignOut,
          },
          [React.createElement('i', { className: 'cil-account-logout', key: 'icon' }), React.createElement('span', { key: 'label' }, 'Sign Out')]
        )
      );
    }

    return React.createElement(
      'div',
      { className: 'sidebar' },
      React.createElement('div', { className: 'sidebar-header' }, React.createElement('h2', null, displayName)),
      React.createElement('nav', { className: 'sidebar-nav' }, customerLinks.map(renderNavItem)),
      React.createElement('div', {
        id: 'sidebar-signout',
        style: { position: 'absolute', bottom: '24px', left: 0, width: '100%', textAlign: 'left' },
      }, footerLinks)
    );
  }

  function renderSidebar() {
    const mountNode = document.getElementById('sidebar');
    if (!mountNode) return;

    ensureReactLoaded()
      .then(() => {
        ReactDOM.createRoot(mountNode).render(React.createElement(CustomerSidebar));
      })
      .catch((err) => {
        console.error('Unable to render customer sidebar', err);
      });
  }

  document.addEventListener('DOMContentLoaded', renderSidebar);
})();
