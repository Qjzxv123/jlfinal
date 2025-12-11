'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getUser, hasRole, hasPageAccess, type UserRole } from '@/lib/auth'

interface ProtectedRouteProps {
  children: React.ReactNode
  allowedRoles: UserRole[]
  pageName?: string
  redirectTo?: string
}

export function ProtectedRoute({ 
  children, 
  allowedRoles, 
  pageName,
  redirectTo = '/login' 
}: ProtectedRouteProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [hasAccess, setHasAccess] = useState(false)

  useEffect(() => {
    const checkAccess = async () => {
      try {
        const user = await getUser()
        
        if (!user) {
          router.push(`${redirectTo}?redirect=${encodeURIComponent(window.location.pathname)}`)
          return
        }

        const roleAccess = await hasRole(allowedRoles)
        
        if (!roleAccess) {
          setHasAccess(false)
          setLoading(false)
          return
        }

        // Check page-specific access for employees
        if (pageName && user.user_metadata?.role === 'employee') {
          const pageAccess = await hasPageAccess(pageName)
          if (!pageAccess) {
            setHasAccess(false)
            setLoading(false)
            return
          }
        }

        setHasAccess(true)
        setLoading(false)
      } catch (error) {
        console.error('Access check failed:', error)
        router.push(redirectTo)
      }
    }

    checkAccess()
  }, [allowedRoles, pageName, redirectTo, router])

  if (loading) {
    return (
      <div className="min-h-screen gradient-bg flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-xl p-10 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-jl-green mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  if (!hasAccess) {
    return (
      <div className="min-h-screen gradient-bg flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-10 text-center max-w-md">
          <div className="text-red-500 text-6xl mb-4">⚠️</div>
          <h1 className="text-2xl font-bold text-gray-800 mb-2">Access Denied</h1>
          <p className="text-gray-600 mb-6">
            You don&apos;t have permission to access this page.
          </p>
          <a
            href="/"
            className="inline-block bg-jl-green text-white font-semibold py-2 px-6 rounded-lg hover:bg-jl-green/90 transition-colors"
          >
            Return Home
          </a>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
