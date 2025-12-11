import { hasRole, hasPageAccess } from '../auth'
import { supabase } from '../supabase'

// Mock supabase
jest.mock('../supabase', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(),
      getSession: jest.fn(),
      signOut: jest.fn(),
      signInWithPassword: jest.fn(),
    },
  },
}))

describe('Auth Utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('hasRole', () => {
    it('should return true if user has allowed role', async () => {
      const mockUser = {
        id: '123',
        user_metadata: { role: 'service_role' as const },
      }
      ;(supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: mockUser },
      })

      const result = await hasRole(['service_role', 'employee'])
      expect(result).toBe(true)
    })

    it('should return false if user does not have allowed role', async () => {
      const mockUser = {
        id: '123',
        user_metadata: { role: 'client' as const },
      }
      ;(supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: mockUser },
      })

      const result = await hasRole(['service_role', 'employee'])
      expect(result).toBe(false)
    })

    it('should return false if user is null', async () => {
      ;(supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: null },
      })

      const result = await hasRole(['service_role'])
      expect(result).toBe(false)
    })
  })

  describe('hasPageAccess', () => {
    it('should return true for service_role on any page', async () => {
      const mockUser = {
        id: '123',
        user_metadata: { role: 'service_role' as const },
      }
      ;(supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: mockUser },
      })

      const result = await hasPageAccess('AnyPage')
      expect(result).toBe(true)
    })

    it('should return true for employee on allowed page', async () => {
      const mockUser = {
        id: '123',
        user_metadata: {
          role: 'employee' as const,
          allowed_pages: ['InventoryScanner', 'Orders'],
        },
      }
      ;(supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: mockUser },
      })

      const result = await hasPageAccess('InventoryScanner')
      expect(result).toBe(true)
    })

    it('should return false for employee on non-allowed page', async () => {
      const mockUser = {
        id: '123',
        user_metadata: {
          role: 'employee' as const,
          allowed_pages: ['InventoryScanner'],
        },
      }
      ;(supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: mockUser },
      })

      const result = await hasPageAccess('AdminDashboard')
      expect(result).toBe(false)
    })
  })
})
