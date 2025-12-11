'use client'

import { ProtectedRoute } from '@/components/ProtectedRoute'
import { CustomerSidebar } from '@/components/CustomerSidebar'
import { useEffect, useState } from 'react'
import { getUser } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

export default function CustomerDashboard() {
  const [displayName, setDisplayName] = useState('')
  const [orderCount, setOrderCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadDashboardData = async () => {
      const user = await getUser()
      if (user) {
        setDisplayName(user.user_metadata?.display_name || 'Customer')
        
        // Load order count
        try {
          const { count } = await supabase
            .from('orders')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id)
          
          setOrderCount(count || 0)
        } catch (error) {
          console.error('Error loading orders:', error)
        }
      }
      setLoading(false)
    }

    loadDashboardData()
  }, [])

  return (
    <ProtectedRoute allowedRoles={['client', 'service_role', 'employee']} pageName="CustomerDashboard">
      <div className="flex min-h-screen gradient-bg">
        <CustomerSidebar />
        
        <div className="ml-60 flex-1 p-8">
          <div className="max-w-7xl mx-auto">
            <div className="bg-white rounded-2xl shadow-xl p-8 mb-8">
              <h1 className="text-3xl font-bold text-gray-800 mb-2">
                Welcome, {displayName}!
              </h1>
              <p className="text-gray-600">Your customer dashboard</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white rounded-2xl shadow-xl p-6">
                <h3 className="text-lg font-semibold text-gray-700 mb-2">My Orders</h3>
                {loading ? (
                  <div className="animate-pulse">
                    <div className="h-8 bg-gray-200 rounded w-20"></div>
                  </div>
                ) : (
                  <p className="text-4xl font-bold text-jl-green">{orderCount}</p>
                )}
              </div>

              <div className="bg-white rounded-2xl shadow-xl p-6">
                <h3 className="text-lg font-semibold text-gray-700 mb-2">Active Products</h3>
                <p className="text-4xl font-bold text-jl-green">-</p>
              </div>

              <div className="bg-white rounded-2xl shadow-xl p-6">
                <h3 className="text-lg font-semibold text-gray-700 mb-2">Pending Items</h3>
                <p className="text-4xl font-bold text-jl-green">-</p>
              </div>
            </div>

            <div className="mt-8 bg-white rounded-2xl shadow-xl p-8">
              <h2 className="text-2xl font-bold text-gray-800 mb-4">Quick Actions</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <a
                  href="/customer/orders"
                  className="block p-4 border-2 border-jl-green rounded-lg hover:bg-jl-green/10 transition-colors"
                >
                  <h3 className="font-semibold text-gray-800 mb-1">View Orders</h3>
                  <p className="text-sm text-gray-600">Check your order history</p>
                </a>
                <a
                  href="/customer/add-product"
                  className="block p-4 border-2 border-jl-green rounded-lg hover:bg-jl-green/10 transition-colors"
                >
                  <h3 className="font-semibold text-gray-800 mb-1">Add Product</h3>
                  <p className="text-sm text-gray-600">Submit a new product</p>
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  )
}
