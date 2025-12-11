'use client'

import { ProtectedRoute } from '@/components/ProtectedRoute'
import { AdminSidebar } from '@/components/AdminSidebar'
import { useEffect, useState } from 'react'
import { getUser } from '@/lib/auth'

export default function EmployeeDashboard() {
  const [displayName, setDisplayName] = useState('')
  const [allowedPages, setAllowedPages] = useState<string[]>([])

  useEffect(() => {
    const loadUserData = async () => {
      const user = await getUser()
      if (user) {
        setDisplayName(user.user_metadata?.display_name || 'Employee')
        setAllowedPages(user.user_metadata?.allowed_pages || [])
      }
    }

    loadUserData()
  }, [])

  return (
    <ProtectedRoute allowedRoles={['employee', 'service_role']} pageName="EmployeeDashboard">
      <div className="flex min-h-screen gradient-bg">
        <AdminSidebar />
        
        <div className="ml-60 flex-1 p-8">
          <div className="max-w-7xl mx-auto">
            <div className="bg-white rounded-2xl shadow-xl p-8 mb-8">
              <h1 className="text-3xl font-bold text-gray-800 mb-2">
                Welcome, {displayName}!
              </h1>
              <p className="text-gray-600">Employee Dashboard</p>
            </div>

            <div className="bg-white rounded-2xl shadow-xl p-8 mb-8">
              <h2 className="text-2xl font-bold text-gray-800 mb-4">Your Access</h2>
              <p className="text-gray-600 mb-4">
                You have access to the following pages:
              </p>
              
              {allowedPages.length > 0 ? (
                <ul className="list-disc list-inside space-y-2">
                  {allowedPages.map((page) => (
                    <li key={page} className="text-gray-700">{page}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-gray-500 italic">
                  No specific pages assigned. Contact your administrator.
                </p>
              )}
            </div>

            <div className="bg-white rounded-2xl shadow-xl p-8">
              <h2 className="text-2xl font-bold text-gray-800 mb-4">Quick Actions</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <a
                  href="/admin/inventory-scanner"
                  className="block p-4 border-2 border-jl-green rounded-lg hover:bg-jl-green/10 transition-colors"
                >
                  <h3 className="font-semibold text-gray-800 mb-1">Scan Inventory</h3>
                  <p className="text-sm text-gray-600">Update product quantities</p>
                </a>
                <a
                  href="/admin/orders"
                  className="block p-4 border-2 border-jl-green rounded-lg hover:bg-jl-green/10 transition-colors"
                >
                  <h3 className="font-semibold text-gray-800 mb-1">View Orders</h3>
                  <p className="text-sm text-gray-600">Check order status</p>
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  )
}
