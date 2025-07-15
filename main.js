// main.js
import './style.css';

// Example: Start OAuth flow for a provider
function startOAuth(provider) {
  window.location.href = `/api/${provider}-oauth-start`;
}

document.getElementById('faire-btn').onclick = () => startOAuth('faire');
document.getElementById('etsy-btn').onclick = () => startOAuth('etsy');
document.getElementById('shopify-btn').onclick = () => startOAuth('shopify');
