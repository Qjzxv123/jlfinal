/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Support for static HTML export if needed
  output: 'standalone',
  // Environment variables available on both client and server
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  },
}

export default nextConfig
