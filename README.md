# JLFINAL Netlify Vite Project

This project is a Vite-based web app (HTML, JS, CSS) with Netlify serverless functions for onboarding Faire, Etsy, and Shopify accounts using OAuth, and saving user data to Supabase.

## Features
- Onboard Faire, Etsy, and Shopify accounts via OAuth
- Netlify serverless functions for backend logic
- User data saved to Supabase
- Best practices for OAuth and API integrations

## Getting Started
1. Install dependencies:
   ```sh
   npm install
   ```
2. Start the dev server:
   ```sh
   npm run dev
   ```
3. Deploy to Netlify for serverless functions support.

## Project Structure
- `/netlify/functions/` — Netlify serverless functions (API endpoints)
- `/index.html`, `/main.js`, `/style.css` — Frontend

## Environment Variables
- Configure your OAuth credentials and Supabase keys in Netlify environment variables.

## Security
- Never commit secrets to the repo.
- Use HTTPS for all OAuth redirects.

---
