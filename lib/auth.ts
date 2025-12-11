import { supabase } from './supabase'

export type UserRole = 'service_role' | 'employee' | 'client'

export interface UserMetadata {
  role: UserRole
  display_name?: string
  allowed_pages?: string[]
}

export interface User {
  id: string
  email?: string
  user_metadata?: UserMetadata
}

/**
 * Get the current user session
 */
export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

/**
 * Get the current user
 */
export async function getUser(): Promise<User | null> {
  const { data: { user } } = await supabase.auth.getUser()
  return user as User | null
}

/**
 * Check if user has required role
 */
export async function hasRole(allowedRoles: UserRole[]): Promise<boolean> {
  const user = await getUser()
  if (!user) return false
  
  const userRole = user.user_metadata?.role
  return userRole ? allowedRoles.includes(userRole) : false
}

/**
 * Check if employee has access to specific page
 */
export async function hasPageAccess(pageName: string): Promise<boolean> {
  const user = await getUser()
  if (!user) return false
  
  const userRole = user.user_metadata?.role
  
  // Service role has access to all pages
  if (userRole === 'service_role') return true
  
  // Employees need to check their allowed_pages
  if (userRole === 'employee') {
    const allowedPages = user.user_metadata?.allowed_pages || []
    // Always allow index, employeedashboard, customerchecklist
    const alwaysAllowed = ['index', 'employeedashboard', 'customerchecklist']
    const pageNameLower = pageName.toLowerCase().replace('.html', '')
    
    return alwaysAllowed.includes(pageNameLower) || allowedPages.includes(pageName)
  }
  
  return true
}

/**
 * Sign out the current user
 */
export async function signOut() {
  await supabase.auth.signOut()
}

/**
 * Sign in with email and password
 */
export async function signInWithPassword(email: string, password: string) {
  return await supabase.auth.signInWithPassword({ email, password })
}
