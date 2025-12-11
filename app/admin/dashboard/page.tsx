'use client'

import { ProtectedRoute } from '@/components/ProtectedRoute'
import { AdminSidebar } from '@/components/AdminSidebar'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface TableStats {
  name: string
  count: number
  loading: boolean
}

export default function AdminDashboard() {
  const [tables, setTables] = useState<TableStats[]>([
    { name: 'Products', count: 0, loading: true },
    { name: 'Orders', count: 0, loading: true },
    { name: 'Customers', count: 0, loading: true },
    { name: 'Inventory', count: 0, loading: true },
  ])

  useEffect(() => {
    const loadTableStats = async () => {
      // Load table statistics
      const tableNames = ['products', 'orders', 'users', 'inventory']
      
      for (let i = 0; i < tableNames.length; i++) {
        try {
          const { count } = await supabase
            .from(tableNames[i])
            .select('*', { count: 'exact', head: true })
          
          setTables(prev => prev.map((table, idx) => 
            idx === i ? { ...table, count: count || 0, loading: false } : table
          ))
        } catch (error) {
          console.error(`Error loading ${tableNames[i]}:`, error)
          setTables(prev => prev.map((table, idx) => 
            idx === i ? { ...table, loading: false } : table
          ))
        }
      }
    }

    loadTableStats()
  }, [])

  return (
    <ProtectedRoute allowedRoles={['service_role']} pageName="AdminDashboard">
      <div className="flex min-h-screen gradient-bg">
        <AdminSidebar />
        
        <div className="ml-60 flex-1 p-8">
          <div className="max-w-7xl mx-auto">
            <div className="bg-white rounded-2xl shadow-xl p-8 mb-8">
              <h1 className="text-3xl font-bold text-gray-800 mb-2">Admin Dashboard</h1>
              <p className="text-gray-600">Welcome to the J&L Naturals management system</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {tables.map((table) => (
                <div key={table.name} className="bg-white rounded-2xl shadow-xl p-6">
                  <h3 className="text-lg font-semibold text-gray-700 mb-2">{table.name}</h3>
                  {table.loading ? (
                    <div className="animate-pulse">
                      <div className="h-8 bg-gray-200 rounded w-20"></div>
                    </div>
                  ) : (
                    <p className="text-4xl font-bold text-jl-green">{table.count}</p>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-8 bg-white rounded-2xl shadow-xl p-8">
              <h2 className="text-2xl font-bold text-gray-800 mb-4">Quick Actions</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <a
                  href="/admin/orders"
                  className="block p-4 border-2 border-jl-green rounded-lg hover:bg-jl-green/10 transition-colors"
                >
                  <h3 className="font-semibold text-gray-800 mb-1">View Orders</h3>
                  <p className="text-sm text-gray-600">Manage incoming orders</p>
                </a>
                <a
                  href="/admin/inventory-scanner"
                  className="block p-4 border-2 border-jl-green rounded-lg hover:bg-jl-green/10 transition-colors"
                >
                  <h3 className="font-semibold text-gray-800 mb-1">Scan Inventory</h3>
                  <p className="text-sm text-gray-600">Update product quantities</p>
                </a>
                <a
                  href="/admin/user-management"
                  className="block p-4 border-2 border-jl-green rounded-lg hover:bg-jl-green/10 transition-colors"
                >
                  <h3 className="font-semibold text-gray-800 mb-1">Manage Users</h3>
                  <p className="text-sm text-gray-600">Add or edit user accounts</p>
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  )
}
