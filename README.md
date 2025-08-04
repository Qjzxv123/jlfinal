# JLFINAL - E-commerce Management Platform

A comprehensive Vite-based web application for managing e-commerce operations across multiple platforms (Faire, Etsy, Shopify) with integrated inventory management, order processing, and administrative tools.

## 🚀 Features

### E-commerce Platform Integration
- **OAuth Authentication** for Faire, Etsy, and Shopify accounts
- **Automated Order Synchronization** with scheduled functions (every 15 minutes)
- **Inventory Management** across multiple platforms
- **Order Fulfillment** and tracking capabilities
- **Webhook Support** for real-time updates

### Customer Portal
- Customer order management and tracking
- Product browsing and ordering
- Order history and status updates
- Customer-specific checklists and documentation

### Administrative Dashboard
- **User Management** - Add, edit, and manage customer accounts
- **Inventory Control** - Scanner-based inventory updates and tracking
- **Order Processing** - View, track, and manage all incoming orders
- **Manufacturing Tools** - Batch creation, instructions, and ingredient tracking
- **Amazon Integration** - Shipment management and label generation
- **Analytics & Reporting** - Database viewer, order tracking, and business insights
- **QR Code Generation** - Product and inventory tracking
- **Invoice Management** - Automated billing and documentation

### Backend Infrastructure
- **Netlify Serverless Functions** for scalable backend operations
- **Supabase Database** for secure data storage and management
- **Shippo Integration** for shipping label generation and tracking
- **Automated Token Refresh** for seamless API integrations
- **Scheduled Jobs** for order synchronization and data updates

## 🛠️ Technology Stack

- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **Build Tool**: Vite
- **Backend**: Netlify Functions (Node.js)
- **Database**: Supabase
- **Authentication**: OAuth 2.0
- **Deployment**: Netlify
- **APIs**: Faire, Etsy, Shopify, Shippo

## 📁 Project Structure

```
├── netlify/functions/          # Serverless backend functions
├── public/                     # Frontend application
│   ├── admin/                  # Administrative dashboard
│   └── Assets/                 # Shared resources and utilities
├── netlify.toml               # Netlify configuration
└── package.json               # Project dependencies
```

## 🚀 Getting Started

### Prerequisites
- Node.js (v16 or higher)
- Netlify CLI
- Supabase account and project
- API credentials for Faire, Etsy, and Shopify

### Installation

1. Clone the repository
```bash
git clone <repository-url>
cd jlfinal
```

2. Install dependencies
```bash
npm install
```

3. Set up environment variables (create `.env` file)
```env
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
FAIRE_CLIENT_ID=your_faire_client_id
FAIRE_CLIENT_SECRET=your_faire_client_secret
ETSY_CLIENT_ID=your_etsy_client_id
ETSY_CLIENT_SECRET=your_etsy_client_secret
SHOPIFY_CLIENT_ID=your_shopify_client_id
SHOPIFY_CLIENT_SECRET=your_shopify_client_secret
SHIPPO_API_TOKEN=your_shippo_api_token
```

4. Start development server
```bash
npm run dev
```

5. Start Netlify functions locally
```bash
netlify dev
```

## 📝 API Endpoints

### OAuth Flows
- `/api/faire-oauth-start` - Initialize Faire OAuth
- `/api/faire-oauth-callback` - Handle Faire OAuth callback
- `/api/etsy-oauth-start` - Initialize Etsy OAuth
- `/api/etsy-oauth-callback` - Handle Etsy OAuth callback
- `/api/shopify-oauth-start` - Initialize Shopify OAuth
- `/api/shopify-oauth-callback` - Handle Shopify OAuth callback

### Data Management
- `/api/faire-get-inventory` - Fetch Faire inventory
- `/api/etsy-get-inventory` - Fetch Etsy inventory
- `/api/faire-sync-inventory` - Sync Faire inventory
- `/api/etsy-sync-inventory` - Sync Etsy inventory
- `/api/shippo-getlabel` - Generate shipping labels

### Scheduled Functions
- `/api/faire-get-orders-cron` - Automated order fetching (every 15 minutes)
- `/api/shippo-get-orders-cron` - Automated shipping updates (every 15 minutes)

## 🔒 Security Features

- OAuth 2.0 implementation with secure token handling
- Automatic token refresh and expiration management
- Environment variable protection for sensitive data
- Secure API endpoint authentication
- Role-based access control for admin functions

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is proprietary and confidential.

## 📞 Support

For support and questions, good luck, I'm extremely busy.