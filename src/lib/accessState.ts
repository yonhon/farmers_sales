export type AppProfile = {
  account_status: 'active' | 'suspended'
}

export type AccessRequest = {
  request_status: 'pending' | 'approved' | 'rejected'
  verification_code_expires_at: string
}

export type AccessState =
  | { kind: 'loading' }
  | { kind: 'active' }
  | { kind: 'suspended' }
  | { kind: 'unregistered'; request: AccessRequest | null }
  | { kind: 'error'; message: string }

type QueryResult<T> = {
  data: T | null
  error: unknown | null
}

export type AccessStateDependencies = {
  getSession: () => Promise<{ hasSession: boolean; error: unknown | null }>
  refreshSession: () => Promise<{ error: unknown | null }>
  getProfile: () => PromiseLike<QueryResult<AppProfile>>
  getAccessRequest: () => PromiseLike<QueryResult<AccessRequest>>
}

async function queryWithSessionRetry<T>(
  query: () => PromiseLike<QueryResult<T>>,
  refreshSession: AccessStateDependencies['refreshSession'],
) {
  let response = await query()
  if (!response.error) return response

  const firstError = response.error
  const refreshResponse = await refreshSession()
  if (refreshResponse.error) throw firstError

  response = await query()
  if (response.error) throw response.error
  return response
}

export async function resolveAccessState(
  dependencies: AccessStateDependencies,
): Promise<Exclude<AccessState, { kind: 'loading' } | { kind: 'error' }>> {
  const sessionResponse = await dependencies.getSession()
  if (sessionResponse.error) throw sessionResponse.error
  if (!sessionResponse.hasSession) throw new Error('認証セッションがありません。')

  const profileResponse = await queryWithSessionRetry(
    dependencies.getProfile,
    dependencies.refreshSession,
  )

  if (profileResponse.data?.account_status === 'active') return { kind: 'active' }
  if (profileResponse.data?.account_status === 'suspended') return { kind: 'suspended' }
  if (profileResponse.data) throw new Error('不明なアカウント状態です。')

  const requestResponse = await queryWithSessionRetry(
    dependencies.getAccessRequest,
    dependencies.refreshSession,
  )
  return { kind: 'unregistered', request: requestResponse.data }
}
