'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getUser, type User } from '@/lib/auth'

export default function Home() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadUser = async () => {
      const currentUser = await getUser()
      setUser(currentUser)
      setLoading(false)
    }
    
    loadUser()
  }, [])

  const handleDashboardClick = () => {
    const role = user?.user_metadata?.role
    
    if (role === 'service_role') {
      router.push('/admin/dashboard')
    } else if (role === 'employee') {
      router.push('/admin/employee-dashboard')
    } else {
      router.push('/customer/dashboard')
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen gradient-bg flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-xl p-10 max-w-md w-full text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-jl-green mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen gradient-bg flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-10 max-w-md w-full">
        <div className="flex justify-end mb-2 min-h-6">
          {user && (
            <div className="text-sm text-gray-600">
              Welcome, {user.user_metadata?.display_name || user.email}
            </div>
          )}
        </div>
        
        <div className="text-center mb-6">
          <img 
            src="/Assets/favicon.ico" 
            alt="J&L Naturals Logo" 
            className="w-16 h-16 mx-auto mb-4 rounded-xl shadow-md"
          />
        </div>

        <h1 className="text-3xl font-bold text-gray-800 text-center mb-2">
          J&L Naturals System
        </h1>
        
        <p className="text-gray-600 text-center mb-8 text-lg">
          Your all-in-one portal for managing products, orders, and more.
        </p>

        <div className="space-y-4">
          <button
            onClick={handleDashboardClick}
            className="w-full bg-jl-green text-white font-semibold py-3 px-6 rounded-lg hover:bg-jl-green/90 transition-colors shadow-md flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Go to Dashboard
          </button>
        </div>

        <div className="mt-8 text-center text-sm text-gray-500">
          <a href="/privacy" className="underline hover:text-gray-700">
            Privacy Policy
          </a>
          <br />
          <span className="mt-2 block">&copy; 2025 J&L Tools</span>
        </div>
      </div>
    </main>
  )
}
