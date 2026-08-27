import { describe, expect, it, vi } from 'vitest'

import { resolveAccessState } from './accessState'

function baseDependencies() {
  return {
    getSession: vi.fn().mockResolvedValue({ hasSession: true, error: null }),
    refreshSession: vi.fn().mockResolvedValue({ error: null }),
    getProfile: vi.fn().mockResolvedValue({
      data: { account_status: 'active' as const },
      error: null,
    }),
    getAccessRequest: vi.fn().mockResolvedValue({ data: null, error: null }),
  }
}

describe('access state resolver', () => {
  it('waits for a session and skips access requests for an active user', async () => {
    const dependencies = baseDependencies()

    await expect(resolveAccessState(dependencies)).resolves.toEqual({ kind: 'active' })
    expect(dependencies.getSession).toHaveBeenCalledOnce()
    expect(dependencies.getAccessRequest).not.toHaveBeenCalled()
    expect(dependencies.refreshSession).not.toHaveBeenCalled()
  })

  it('refreshes the session once and retries a failed profile query', async () => {
    const dependencies = baseDependencies()
    dependencies.getProfile
      .mockResolvedValueOnce({ data: null, error: new Error('401') })
      .mockResolvedValueOnce({ data: { account_status: 'active' }, error: null })

    await expect(resolveAccessState(dependencies)).resolves.toEqual({ kind: 'active' })
    expect(dependencies.refreshSession).toHaveBeenCalledOnce()
    expect(dependencies.getProfile).toHaveBeenCalledTimes(2)
    expect(dependencies.getAccessRequest).not.toHaveBeenCalled()
  })

  it('rejects instead of treating a persistent query failure as an unregistered user', async () => {
    const dependencies = baseDependencies()
    dependencies.getProfile.mockResolvedValue({ data: null, error: new Error('401') })

    await expect(resolveAccessState(dependencies)).rejects.toThrow('401')
    expect(dependencies.refreshSession).toHaveBeenCalledOnce()
    expect(dependencies.getAccessRequest).not.toHaveBeenCalled()
  })

  it('loads an access request only after confirming that the profile is absent', async () => {
    const dependencies = baseDependencies()
    dependencies.getProfile.mockResolvedValue({ data: null, error: null })
    dependencies.getAccessRequest.mockResolvedValue({
      data: {
        request_status: 'pending',
        verification_code_expires_at: '2026-08-28T00:00:00Z',
      },
      error: null,
    })

    await expect(resolveAccessState(dependencies)).resolves.toEqual({
      kind: 'unregistered',
      request: {
        request_status: 'pending',
        verification_code_expires_at: '2026-08-28T00:00:00Z',
      },
    })
    expect(dependencies.getAccessRequest).toHaveBeenCalledOnce()
  })

  it('rejects when no authenticated session is available', async () => {
    const dependencies = baseDependencies()
    dependencies.getSession.mockResolvedValue({ hasSession: false, error: null })

    await expect(resolveAccessState(dependencies)).rejects.toThrow('認証セッションがありません。')
    expect(dependencies.getProfile).not.toHaveBeenCalled()
  })
})
