// main.js
import './style.css';

// Example: Start OAuth flow for a provider
function startOAuth(provider) {
  window.location.href = `/api/${provider}-oauth-start`;
}

document.getElementById('faire-btn').onclick = () => startOAuth('faire');
document.getElementById('etsy-btn').onclick = () => startOAuth('etsy');

// Shopify: Use input value for domain
document.getElementById('shopify-btn').onclick = () => {
  const domain = document.getElementById('shopify-domain').value.trim();
  if (!domain) {
    alert('Please enter your Shopify domain.');
    return;
  }
  // Redirect to the Netlify function with the shop as a query parameter
  window.location.href = `/.netlify/functions/shopify-oauth-start?shop=${encodeURIComponent(domain)}`;
};
