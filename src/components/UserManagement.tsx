import { useEffect, useState } from 'react'

import { supabase } from '../lib/supabase'

type AppRole = 'viewer' | 'inputter' | 'admin'
type AccountStatus = 'active' | 'suspended'

type AccessRequestRow = {
  user_id: string
  requested_display_name: string
  verification_code_expires_at: string
  created_at: string
}

type AppUserRow = {
  user_id: string
  display_name: string
  app_role: AppRole
  account_status: AccountStatus
}

type UserManagementProps = {
  currentUserId: string
}

function PendingRequest({ request, onReviewed }: {
  request: AccessRequestRow
  onReviewed: () => Promise<void>
}) {
  const [code, setCode] = useState('')
  const [displayName, setDisplayName] = useState(request.requested_display_name)
  const [appRole, setAppRole] = useState<AppRole>('viewer')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  async function review(approve: boolean) {
    if (!supabase) return
    setIsSubmitting(true)
    setErrorMessage('')

    const { error } = await supabase.rpc('review_app_access_request', {
      p_user_id: request.user_id,
      p_approve: approve,
      p_verification_code: approve ? code.trim() : null,
      p_app_role: appRole,
      p_display_name: displayName.trim(),
    })

    setIsSubmitting(false)
    if (error) {
      setErrorMessage(error.message)
      return
    }
    await onReviewed()
  }

  return (
    <article className="request-card">
      <div>
        <strong>{request.requested_display_name}</strong>
        <small>申請日時: {new Date(request.created_at).toLocaleString('ja-JP')}</small>
        <small>コード期限: {new Date(request.verification_code_expires_at).toLocaleString('ja-JP')}</small>
      </div>
      <label>
        表示名
        <input value={displayName} maxLength={80} onChange={(event) => setDisplayName(event.target.value)} />
      </label>
      <label>
        権限
        <select value={appRole} onChange={(event) => setAppRole(event.target.value as AppRole)}>
          <option value="viewer">閲覧</option>
          <option value="inputter">入力</option>
          <option value="admin">管理者</option>
        </select>
      </label>
      <label>
        LINEで受け取った確認コード
        <input
          value={code}
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
        />
      </label>
      {errorMessage && <p className="form-error" role="alert">{errorMessage}</p>}
      <div className="request-actions">
        <button
          className="primary-button"
          type="button"
          disabled={isSubmitting || code.length !== 6 || !displayName.trim()}
          onClick={() => void review(true)}
        >
          承認
        </button>
        <button
          className="danger-button"
          type="button"
          disabled={isSubmitting}
          onClick={() => void review(false)}
        >
          却下
        </button>
      </div>
    </article>
  )
}

function ManagedUser({ user, isCurrentUser, onUpdated }: {
  user: AppUserRow
  isCurrentUser: boolean
  onUpdated: () => Promise<void>
}) {
  const [appRole, setAppRole] = useState(user.app_role)
  const [accountStatus, setAccountStatus] = useState(user.account_status)
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  async function save() {
    if (!supabase) return
    setIsSaving(true)
    setErrorMessage('')
    const { error } = await supabase
      .from('app_users')
      .update({ app_role: appRole, account_status: accountStatus })
      .eq('user_id', user.user_id)
    setIsSaving(false)

    if (error) {
      setErrorMessage(error.message)
      return
    }
    await onUpdated()
  }

  return (
    <tr>
      <td>
        <strong>{user.display_name}</strong>
        {isCurrentUser ? <small className="current-user-label">自分</small> : null}
        {errorMessage && <span className="form-error" role="alert">{errorMessage}</span>}
      </td>
      <td>
        <select
          value={appRole}
          disabled={isCurrentUser}
          onChange={(event) => setAppRole(event.target.value as AppRole)}
        >
          <option value="viewer">閲覧</option>
          <option value="inputter">入力</option>
          <option value="admin">管理者</option>
        </select>
      </td>
      <td>
        <select
          value={accountStatus}
          disabled={isCurrentUser}
          onChange={(event) => setAccountStatus(event.target.value as AccountStatus)}
        >
          <option value="active">有効</option>
          <option value="suspended">利用停止</option>
        </select>
      </td>
      <td>
        <button className="secondary-button compact" type="button" disabled={isSaving} onClick={() => void save()}>
          {isSaving ? '保存中…' : '保存'}
        </button>
      </td>
    </tr>
  )
}

export function UserManagement({ currentUserId }: UserManagementProps) {
  const [requests, setRequests] = useState<AccessRequestRow[]>([])
  const [users, setUsers] = useState<AppUserRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  async function load() {
    if (!supabase) return
    setErrorMessage('')
    const [requestResponse, userResponse] = await Promise.all([
      supabase
        .from('access_requests')
        .select('user_id, requested_display_name, verification_code_expires_at, created_at')
        .eq('request_status', 'pending')
        .order('created_at'),
      supabase
        .from('app_users')
        .select('user_id, display_name, app_role, account_status')
        .order('display_name'),
    ])

    if (requestResponse.error) throw requestResponse.error
    if (userResponse.error) throw userResponse.error
    setRequests((requestResponse.data ?? []) as AccessRequestRow[])
    setUsers((userResponse.data ?? []) as AppUserRow[])
  }

  useEffect(() => {
    let active = true
    void load()
      .catch((error) => {
        console.error(error)
        if (active) setErrorMessage('ユーザー情報を取得できませんでした。')
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  async function reload() {
    try {
      await load()
    } catch (error) {
      console.error(error)
      setErrorMessage('ユーザー情報を更新できませんでした。')
    }
  }

  return (
    <section className="user-management" id="access-requests">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">USER MANAGEMENT</p>
          <h2>ユーザー登録と権限</h2>
        </div>
        <button className="secondary-button compact" type="button" onClick={() => void reload()}>
          更新
        </button>
      </div>

      {isLoading && <div className="status-panel">ユーザー情報を読み込んでいます…</div>}
      {errorMessage && <div className="status-panel error" role="alert">{errorMessage}</div>}

      {!isLoading && !errorMessage ? (
        <>
          <div className="management-section">
            <h3>承認待ち <span>{requests.length}</span></h3>
            {requests.length ? (
              <div className="request-grid">
                {requests.map((request) => (
                  <PendingRequest key={request.user_id} request={request} onReviewed={reload} />
                ))}
              </div>
            ) : <p className="muted">現在、承認待ちの申請はありません。</p>}
          </div>

          <div className="management-section">
            <h3>登録済みユーザー <span>{users.length}</span></h3>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr><th>表示名</th><th>権限</th><th>状態</th><th>操作</th></tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <ManagedUser
                      key={user.user_id}
                      user={user}
                      isCurrentUser={user.user_id === currentUserId}
                      onUpdated={reload}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </section>
  )
}
