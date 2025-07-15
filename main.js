// main.js
import './style.css';

// Example: Start OAuth flow for a provider
function startOAuth(provider) {
  window.location.href = `/.netlify/functions/${provider}-oauth-start`;
}

document.getElementById('faire-btn').onclick = () => startOAuth('faire');
document.getElementById('etsy-btn').onclick = () => startOAuth('etsy');

// Shopify: Use input value for domain
document.getElementById('shopify-btn').onclick = () => {
  let domain = document.getElementById('shopify-domain').value.trim();
  if (!domain) {
    alert('Please enter your Shopify domain.');
    return;
  }
  // Ensure domain ends with .myshopify.com
  if (!domain.endsWith('.myshopify.com')) {
    domain = domain.replace(/\s+/g, '');
    domain = domain.replace(/\.myshopify\.com.*/, '');
    domain = `${domain}.myshopify.com`;
  }
  window.location.href = `/.netlify/functions/shopify-oauth-start?shop=${encodeURIComponent(domain)}`;
};
