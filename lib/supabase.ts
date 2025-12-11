import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ypvyrophqkfqwpefuigi.supabase.co'
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlwdnlyb3BocWtmcXdwZWZ1aWdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgwMjQzMjAsImV4cCI6MjA2MzYwMDMyMH0.fDY3ZA-sVDoEK-_CgrgdjlUtVdH3YwULSAKjK9oFRbQ'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  }
})

export default supabase
