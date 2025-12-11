'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { signOut } from '@/lib/auth'
import { getUser } from '@/lib/auth'

export function AdminSidebar() {
  const pathname = usePathname()
  const [displayName, setDisplayName] = useState('User')

  useEffect(() => {
    const loadUser = async () => {
      const user = await getUser()
      if (user?.user_metadata?.display_name) {
        setDisplayName(user.user_metadata.display_name)
      }
    }
    loadUser()
  }, [])

  const handleSignOut = async () => {
    await signOut()
    window.location.href = '/login'
  }

  const isActive = (href: string) => {
    return pathname === href || pathname?.startsWith(href + '/')
  }

  const navItems = [
    { href: '/admin/dashboard', icon: 'cil-briefcase', label: 'Admin Dashboard' },
    { href: '/admin/employee-dashboard', icon: 'cil-speedometer', label: 'Employee Dashboard' },
    { href: '/admin/calendar', icon: 'cil-calendar', label: 'Calendar' },
    { href: '/admin/orders', icon: 'cil-3d', label: 'Order Viewer' },
    { href: '/admin/analytics', icon: 'cil-bar-chart', label: 'Business Analytics' },
    { href: '/admin/checklist', icon: 'cil-check', label: 'Checklist' },
    { href: '/admin/amazon-shipments', icon: 'cib-amazon', label: 'Amazon Shipments' },
    { href: '/admin/warehouse-shipments', icon: 'cil-truck', label: 'Warehouse Shipments' },
    { href: '/admin/manufacturing', icon: 'cil-factory', label: 'Manufacturing Tracker' },
    { href: '/admin/incoming-ingredients', icon: 'cil-truck', label: 'Incoming Ingredients' },
    { href: '/admin/database-viewer', icon: 'cil-find-in-page', label: 'Database Viewer' },
    { href: '/admin/logs', icon: 'cil-history', label: 'Quantity Update Logs' },
    { href: '/admin/inventory-scanner', icon: 'cil-center-focus', label: 'Scanner' },
    { href: '/admin/add-item', icon: 'cil-plus', label: 'Add/Update Item' },
    { href: '/admin/qrcode', icon: 'cil-qr-code', label: 'QR Code Generator' },
    { href: '/admin/quoting', icon: 'cil-money', label: 'Product Quoting' },
    { href: '/admin/invoice', icon: 'cil-dollar', label: 'Invoice Calculator' },
    { href: '/admin/user-management', icon: 'cil-user', label: 'User Management' },
  ]

  return (
    <div className="sidebar fixed left-0 top-0 h-screen w-60 bg-white shadow-lg flex flex-col">
      <div className="sidebar-header p-4 border-b">
        <h2 className="text-xl font-bold text-gray-800">{displayName}</h2>
      </div>
      
      <nav className="sidebar-nav flex-1 overflow-y-auto py-4">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`nav-item flex items-center gap-3 px-4 py-3 text-gray-700 hover:bg-jl-green/10 hover:text-jl-green transition-colors ${
              isActive(item.href) ? 'bg-jl-green/20 text-jl-green font-semibold' : ''
            }`}
          >
            <i className={item.icon}></i>
            <span>{item.label}</span>
          </Link>
        ))}
        
        <Link
          href="/customer/checklist"
          className="nav-item flex items-center gap-3 px-4 py-3 text-gray-700 hover:bg-jl-green/10 hover:text-jl-green transition-colors"
        >
          <i className="cil-exit-to-app"></i>
          <span>Exit Admin Portal</span>
        </Link>
        
        <button
          onClick={handleSignOut}
          className="nav-item flex items-center gap-3 px-4 py-3 text-gray-700 hover:bg-jl-green/10 hover:text-jl-green transition-colors w-full text-left"
        >
          <i className="cil-account-logout"></i>
          <span>Sign Out</span>
        </button>
      </nav>
    </div>
  )
}
