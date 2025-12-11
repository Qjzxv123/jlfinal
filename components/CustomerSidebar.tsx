'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { signOut, getUser } from '@/lib/auth'

export function CustomerSidebar() {
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
    { href: '/customer/dashboard', icon: 'cil-speedometer', label: 'Dashboard' },
    { href: '/customer/orders', icon: 'cil-3d', label: 'My Orders' },
    { href: '/customer/order-view', icon: 'cil-list', label: 'Order Details' },
    { href: '/customer/checklist', icon: 'cil-check', label: 'Checklist' },
    { href: '/customer/analytics', icon: 'cil-bar-chart', label: 'Analytics' },
    { href: '/customer/add-product', icon: 'cil-plus', label: 'Add Product' },
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
