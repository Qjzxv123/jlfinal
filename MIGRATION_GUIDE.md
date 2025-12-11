# Migration Guide: Vite to Next.js

This document outlines the migration from the Vite-based vanilla JavaScript application to Next.js with React and TypeScript.

## Overview

The application has been successfully refactored to use modern technologies while maintaining backward compatibility with existing features.

## Technology Changes

### Before (Vite Stack)
- **Frontend**: Vanilla JavaScript, HTML, CSS
- **Build Tool**: Vite
- **No Type Safety**: Plain JavaScript
- **No Testing**: No test infrastructure
- **No Component Reusability**: Copy-paste code patterns

### After (Next.js Stack)
- **Frontend**: React 19, TypeScript
- **Framework**: Next.js 16 with App Router
- **Styling**: Tailwind CSS
- **Testing**: Jest + React Testing Library (13 tests passing)
- **Type Safety**: Full TypeScript coverage
- **Component Architecture**: Reusable React components

## What's Been Migrated

### ✅ Core Infrastructure
- [x] Next.js setup with TypeScript
- [x] Tailwind CSS configuration
- [x] Jest testing infrastructure
- [x] Build and development scripts
- [x] Environment variable configuration

### ✅ Authentication & Authorization
- [x] Supabase client integration
- [x] Authentication utilities (login, logout, session management)
- [x] Role-based access control (service_role, employee, client)
- [x] Protected route wrapper component
- [x] Page-level access control for employees

### ✅ Pages Converted to React
1. **Home Page** (`/`)
   - Role-based dashboard routing
   - User welcome message
   - Authentication check

2. **Login Page** (`/login`)
   - Email/password authentication
   - Redirect after login
   - Error handling

3. **Admin Dashboard** (`/admin/dashboard`)
   - Database statistics
   - Quick action links
   - Protected route (service_role only)

4. **Employee Dashboard** (`/admin/employee-dashboard`)
   - User access information
   - Role-based features
   - Protected route (employee, service_role)

5. **Customer Dashboard** (`/customer/dashboard`)
   - Order statistics
   - Quick actions
   - Protected route (client, employee, service_role)

6. **Privacy Policy** (`/privacy`)
   - Static content page

### ✅ Shared Components
- `ProtectedRoute`: Wrapper for pages requiring authentication
- `AdminSidebar`: Navigation for admin/employee users
- `CustomerSidebar`: Navigation for customer users

### ✅ Library Functions
- `lib/supabase.ts`: Supabase client initialization
- `lib/auth.ts`: Authentication and authorization utilities

## What Remains Unchanged

### Backend (Netlify Functions)
All Netlify Functions remain unchanged and fully functional:
- OAuth callbacks (Faire, Etsy, Shopify)
- Inventory sync functions
- Order processing functions
- Scheduled CRON jobs
- Webhook handlers

### Legacy HTML Pages
35 HTML pages in the `public/` directory remain accessible:
- All admin pages (except Dashboard which has been migrated)
- Customer pages (Orders, Analytics, etc.)
- Utility pages (Scanner, QR Code Generator, etc.)

These can be incrementally migrated to React as needed.

## Running the Application

### Development
```bash
npm run dev
```
Access at http://localhost:3000

### Testing
```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

### Building for Production
```bash
npm run build
```

### With Netlify Functions
```bash
netlify dev
```

## Environment Variables

Copy `.env.example` to `.env.local` and configure:

```env
# Required for frontend
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_key

# Required for Netlify Functions
FAIRE_CLIENT_ID=...
FAIRE_CLIENT_SECRET=...
ETSY_CLIENT_ID=...
ETSY_CLIENT_SECRET=...
SHOPIFY_CLIENT_ID=...
SHOPIFY_CLIENT_SECRET=...
SHIPPO_API_TOKEN=...
```

## Benefits of Migration

### Developer Experience
- ✅ Hot module replacement (instant updates)
- ✅ TypeScript autocomplete and type checking
- ✅ Modern React development patterns
- ✅ Component-based architecture
- ✅ Automated testing

### Code Quality
- ✅ Type safety prevents runtime errors
- ✅ Reusable components reduce code duplication
- ✅ Test coverage ensures reliability
- ✅ ESLint integration for code standards
- ✅ Better code organization

### Performance
- ✅ Optimized production builds
- ✅ Automatic code splitting
- ✅ Fast refresh during development
- ✅ Static page generation where possible

### Maintainability
- ✅ Easier to understand and modify
- ✅ Clear separation of concerns
- ✅ Documented with TypeScript types
- ✅ Testable components and utilities

## Next Steps

### Recommended Migration Order
1. Convert remaining admin pages (high priority)
2. Convert customer pages
3. Add tests for new pages
4. Optimize performance
5. Remove legacy HTML files once all migrated

### Adding New Pages

1. Create a new page in `app/` directory:
```typescript
// app/new-page/page.tsx
'use client'

import { ProtectedRoute } from '@/components/ProtectedRoute'

export default function NewPage() {
  return (
    <ProtectedRoute allowedRoles={['service_role']}>
      <div>Your page content</div>
    </ProtectedRoute>
  )
}
```

2. Add tests in `app/__tests__/`:
```typescript
// app/__tests__/new-page.test.tsx
import { render, screen } from '@testing-library/react'
import NewPage from '../new-page/page'

// Mock dependencies
jest.mock('@/lib/auth')

describe('NewPage', () => {
  it('renders page content', () => {
    // Your test
  })
})
```

3. Run tests and build:
```bash
npm test
npm run build
```

## Deployment

The application is configured for Netlify deployment:

1. Build command: `npm run build`
2. Publish directory: `.next`
3. Functions directory: `netlify/functions`

Netlify will automatically:
- Build the Next.js application
- Deploy serverless functions
- Set up scheduled CRON jobs

## Troubleshooting

### Tests Failing
```bash
# Clear Jest cache
npx jest --clearCache
npm test
```

### Build Errors
```bash
# Clean build artifacts
rm -rf .next node_modules
npm install
npm run build
```

### Type Errors
```bash
# Check TypeScript errors
npx tsc --noEmit
```

## Support

For questions or issues:
1. Check this migration guide
2. Review existing component examples
3. Check Next.js documentation: https://nextjs.org/docs
4. Check React documentation: https://react.dev

## Conclusion

The migration to Next.js provides a solid foundation for future development while maintaining all existing functionality. The incremental approach allows for continued operation of legacy features while gradually modernizing the codebase.
