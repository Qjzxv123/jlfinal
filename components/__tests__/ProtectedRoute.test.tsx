import { render, screen, waitFor } from '@testing-library/react'
import { useRouter } from 'next/navigation'
import { ProtectedRoute } from '../ProtectedRoute'
import { getUser, hasRole, hasPageAccess } from '@/lib/auth'

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}))

jest.mock('@/lib/auth', () => ({
  getUser: jest.fn(),
  hasRole: jest.fn(),
  hasPageAccess: jest.fn(),
}))

describe('ProtectedRoute', () => {
  const mockPush = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    ;(useRouter as jest.Mock).mockReturnValue({
      push: mockPush,
    })
  })

  it('shows loading state initially', () => {
    ;(getUser as jest.Mock).mockImplementation(() => new Promise(() => {}))

    render(
      <ProtectedRoute allowedRoles={['service_role']}>
        <div>Protected Content</div>
      </ProtectedRoute>
    )

    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('redirects to login if user is not authenticated', async () => {
    ;(getUser as jest.Mock).mockResolvedValue(null)

    render(
      <ProtectedRoute allowedRoles={['service_role']}>
        <div>Protected Content</div>
      </ProtectedRoute>
    )

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('/login'))
    })
  })

  it('shows access denied if user does not have required role', async () => {
    ;(getUser as jest.Mock).mockResolvedValue({
      id: '123',
      user_metadata: { role: 'client' },
    })
    ;(hasRole as jest.Mock).mockResolvedValue(false)

    render(
      <ProtectedRoute allowedRoles={['service_role']}>
        <div>Protected Content</div>
      </ProtectedRoute>
    )

    await waitFor(() => {
      expect(screen.getByText('Access Denied')).toBeInTheDocument()
    })
  })

  it('renders children when user has access', async () => {
    ;(getUser as jest.Mock).mockResolvedValue({
      id: '123',
      user_metadata: { role: 'service_role' },
    })
    ;(hasRole as jest.Mock).mockResolvedValue(true)

    render(
      <ProtectedRoute allowedRoles={['service_role']}>
        <div>Protected Content</div>
      </ProtectedRoute>
    )

    await waitFor(() => {
      expect(screen.getByText('Protected Content')).toBeInTheDocument()
    })
  })
})
