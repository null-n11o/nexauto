// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock @supabase/ssr
const mockGetUser = vi.fn()
vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: { getUser: mockGetUser },
  })),
}))

// Import after mocks
const { proxy: middleware } = await import('@/proxy')

function makeRequest(path: string, baseUrl = 'http://localhost:3000') {
  return new NextRequest(new URL(path, baseUrl))
}

describe('middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
  })

  describe('unauthenticated user', () => {
    beforeEach(() => {
      mockGetUser.mockResolvedValue({ data: { user: null } })
    })

    it('redirects to /login when accessing a protected route', async () => {
      const req = makeRequest('/app/posts')
      const response = await middleware(req)
      expect(response.status).toBe(307)
      expect(response.headers.get('location')).toBe('http://localhost:3000/app/login')
    })

    it('serves the public landing page without calling Supabase', async () => {
      const req = makeRequest('/')
      const response = await middleware(req)
      expect(response.status).toBe(200)
      expect(mockGetUser).not.toHaveBeenCalled()
    })

    it('allows access to /login without redirect', async () => {
      const req = makeRequest('/app/login')
      const response = await middleware(req)
      expect(response.status).not.toBe(307)
    })

    it.each(['/app/forgot-password', '/app/reset-password'])('allows access to %s without redirect', async path => {
      const req = makeRequest(path)
      const response = await middleware(req)
      expect(response.status).not.toBe(307)
    })

    it('allows access to /api routes without redirect', async () => {
      const req = makeRequest('/api/health')
      const response = await middleware(req)
      expect(response.status).not.toBe(307)
    })
  })

  describe('authenticated user', () => {
    beforeEach(() => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    })

    it('keeps the public landing page accessible', async () => {
      const response = await middleware(makeRequest('/'))
      expect(response.status).toBe(200)
      expect(mockGetUser).not.toHaveBeenCalled()
    })

    it('allows access to protected routes', async () => {
      const req = makeRequest('/app/posts')
      const response = await middleware(req)
      expect(response.status).not.toBe(307)
    })

    it('redirects from /login to /posts', async () => {
      const req = makeRequest('/app/login')
      const response = await middleware(req)
      expect(response.status).toBe(307)
      expect(response.headers.get('location')).toBe('http://localhost:3000/app/posts')
    })

    it.each(['/app/forgot-password', '/app/reset-password'])('allows authenticated users to stay on %s', async path => {
      const req = makeRequest(path)
      const response = await middleware(req)
      expect(response.status).not.toBe(307)
    })
  })
})
