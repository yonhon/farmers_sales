import { lazy, Suspense, useCallback, useEffect, useState } from 'react'

import { resolveAccessState } from '../lib/accessState'
import type { AccessRequest, AccessState, AppProfile } from '../lib/accessState'
import { supabase } from '../lib/supabase'

const Dashboard = lazy(() =>
  import('./Dashboard').then((module) => ({ default: module.Dashboard })),
)

type AccessGateProps = {
  userId: string
  suggestedDisplayName: string
  onSignOut: () => Promise<void>
}

type RequestResult = {
  verification_code: string
  expires_at: string
  request_status: string
}

export function AccessGate({ userId, suggestedDisplayName, onSignOut }: AccessGateProps) {
  const [accessState, setAccessState] = useState<AccessState>({ kind: 'loading' })
  const [displayName, setDisplayName] = useState(suggestedDisplayName)
  const [verificationCode, setVerificationCode] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const fetchAccessState = useCallback(async () => {
    if (!supabase) throw new Error('Supabaseが設定されていません。')
    const client = supabase

    return resolveAccessState({
      getSession: async () => {
        const { data, error } = await client.auth.getSession()
        return { hasSession: Boolean(data.session), error }
      },
      refreshSession: async () => {
        const { error } = await client.auth.refreshSession()
        return { error }
      },
      getProfile: async () => {
        const response = await client
          .from('app_users')
          .select('account_status')
          .eq('user_id', userId)
          .maybeSingle()
        return {
          data: response.data as AppProfile | null,
          error: response.error,
        }
      },
      getAccessRequest: async () => {
        const response = await client
          .from('access_requests')
          .select('request_status, verification_code_expires_at')
          .eq('user_id', userId)
          .maybeSingle()
        return {
          data: response.data as AccessRequest | null,
          error: response.error,
        }
      },
    })
  }, [userId])

  useEffect(() => {
    let active = true

    void fetchAccessState()
      .then((state) => {
        if (active) setAccessState(state)
      })
      .catch((error) => {
        console.error(error)
        if (active) {
          setAccessState({
            kind: 'error',
            message: '利用状態を確認できませんでした。時間をおいて再度お試しください。',
          })
        }
      })

    return () => {
      active = false
    }
  }, [fetchAccessState])

  const isPending = accessState.kind === 'unregistered'
    && accessState.request?.request_status === 'pending'

  useEffect(() => {
    if (!isPending) return undefined

    const timer = window.setInterval(() => {
      void fetchAccessState()
        .then((state) => setAccessState(state))
        .catch((error) => console.error(error))
    }, 15_000)

    return () => window.clearInterval(timer)
  }, [fetchAccessState, isPending])

  async function retryAccessState() {
    setAccessState({ kind: 'loading' })
    try {
      const state = await fetchAccessState()
      setErrorMessage('')
      setAccessState(state)
    } catch (error) {
      console.error(error)
      setAccessState({
        kind: 'error',
        message: '利用状態を確認できませんでした。時間をおいて再度お試しください。',
      })
    }
  }

  async function requestAccess() {
    if (!supabase) return
    setIsSubmitting(true)
    setErrorMessage('')

    const { data, error } = await supabase.rpc('request_app_access', {
      p_display_name: displayName.trim(),
    })

    setIsSubmitting(false)
    if (error) {
      setErrorMessage(error.message)
      return
    }

    const result = (Array.isArray(data) ? data[0] : data) as RequestResult | null
    if (!result) {
      setErrorMessage('確認コードを発行できませんでした。')
      return
    }

    setVerificationCode(result.verification_code)
    setExpiresAt(result.expires_at)
    setAccessState({
      kind: 'unregistered',
      request: {
        request_status: 'pending',
        verification_code_expires_at: result.expires_at,
      },
    })
  }

  if (accessState.kind === 'loading') {
    return <main className="loading-screen">利用状態を確認しています…</main>
  }

  if (accessState.kind === 'active') {
    return (
      <Suspense fallback={<main className="loading-screen">画面を読み込んでいます…</main>}>
        <Dashboard userId={userId} onSignOut={onSignOut} />
      </Suspense>
    )
  }

  if (accessState.kind === 'suspended') {
    return (
      <main className="access-shell">
        <section className="access-card">
          <p className="eyebrow">ACCOUNT SUSPENDED</p>
          <h1>このアカウントは利用停止中です</h1>
          <p>再開が必要な場合は、管理者へLINEでお問い合わせください。</p>
          <button className="secondary-button" type="button" onClick={() => void onSignOut()}>
            ログアウト
          </button>
        </section>
      </main>
    )
  }

  if (accessState.kind === 'error') {
    return (
      <main className="access-shell">
        <section className="access-card">
          <p className="eyebrow">TEMPORARY ERROR</p>
          <h1>利用状態を確認できませんでした</h1>
          <p role="alert">{accessState.message}</p>
          <div className="access-actions">
            <button className="primary-button" type="button" onClick={() => void retryAccessState()}>
              再試行
            </button>
            <button className="text-link-button" type="button" onClick={() => void onSignOut()}>
              ログアウト
            </button>
          </div>
        </section>
      </main>
    )
  }

  const accessRequest = accessState.request

  return (
    <main className="access-shell">
      <section className="access-card">
        <p className="eyebrow">FIRST TIME REGISTRATION</p>
        <h1>利用申請</h1>
        <p>
          初回のみ管理者の承認が必要です。確認コードを発行し、普段お使いのLINEから管理者へ送ってください。
        </p>

        <label>
          管理者が確認できるお名前
          <input
            type="text"
            value={displayName}
            maxLength={80}
            onChange={(event) => setDisplayName(event.target.value)}
            required
          />
        </label>

        {verificationCode ? (
          <div className="verification-code" aria-live="polite">
            <span>LINEで送る確認コード</span>
            <strong>{verificationCode}</strong>
            <small>{new Date(expiresAt).toLocaleTimeString('ja-JP')}まで有効</small>
          </div>
        ) : isPending ? (
          <div className="status-panel">
            <p>申請は承認待ちです。コードが分からない場合は再発行してください。</p>
          </div>
        ) : accessRequest?.request_status === 'rejected' ? (
          <div className="status-panel error">
            <p>申請は承認されませんでした。必要な場合は管理者へお問い合わせください。</p>
          </div>
        ) : null}

        {errorMessage && <p className="form-error" role="alert">{errorMessage}</p>}

        <div className="access-actions">
          <button
            className="primary-button"
            type="button"
            disabled={isSubmitting || !displayName.trim()}
            onClick={() => void requestAccess()}
          >
            {isSubmitting ? '発行中…' : isPending ? '確認コードを再発行' : '確認コードを発行'}
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void retryAccessState()}
          >
            承認状態を更新
          </button>
          <button className="text-link-button" type="button" onClick={() => void onSignOut()}>
            ログアウト
          </button>
        </div>
      </section>
    </main>
  )
}
