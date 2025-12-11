import { render, screen, waitFor } from '@testing-library/react'
import { useRouter } from 'next/navigation'
import Home from '../page'
import { getUser } from '@/lib/auth'

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}))

// Mock auth
jest.mock('@/lib/auth', () => ({
  getUser: jest.fn(),
}))

describe('Home Page', () => {
  const mockPush = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    ;(useRouter as jest.Mock).mockReturnValue({
      push: mockPush,
    })
  })

  it('renders loading state initially', () => {
    ;(getUser as jest.Mock).mockImplementation(() => new Promise(() => {}))
    
    render(<Home />)
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('renders home page with user info', async () => {
    const mockUser = {
      id: '123',
      email: 'test@example.com',
      user_metadata: {
        role: 'client' as const,
        display_name: 'Test User',
      },
    }
    ;(getUser as jest.Mock).mockResolvedValue(mockUser)

    render(<Home />)

    await waitFor(() => {
      expect(screen.getByText('Welcome, Test User')).toBeInTheDocument()
    })

    expect(screen.getByText('J&L Naturals System')).toBeInTheDocument()
    expect(screen.getByText('Go to Dashboard')).toBeInTheDocument()
  })

  it('renders without user info when not logged in', async () => {
    ;(getUser as jest.Mock).mockResolvedValue(null)

    render(<Home />)

    await waitFor(() => {
      expect(screen.getByText('J&L Naturals System')).toBeInTheDocument()
    })

    expect(screen.queryByText(/Welcome/)).not.toBeInTheDocument()
  })
})
