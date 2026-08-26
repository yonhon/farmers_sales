import { lazy, Suspense, useCallback, useEffect, useState } from 'react'

import { supabase } from '../lib/supabase'

const Dashboard = lazy(() =>
  import('./Dashboard').then((module) => ({ default: module.Dashboard })),
)

type AccessGateProps = {
  userId: string
  suggestedDisplayName: string
  onSignOut: () => Promise<void>
}

type AppProfile = {
  account_status: 'active' | 'suspended'
}

type AccessRequest = {
  request_status: 'pending' | 'approved' | 'rejected'
  verification_code_expires_at: string
}

type RequestResult = {
  verification_code: string
  expires_at: string
  request_status: string
}

export function AccessGate({ userId, suggestedDisplayName, onSignOut }: AccessGateProps) {
  const [profile, setProfile] = useState<AppProfile | null>(null)
  const [accessRequest, setAccessRequest] = useState<AccessRequest | null>(null)
  const [displayName, setDisplayName] = useState(suggestedDisplayName)
  const [verificationCode, setVerificationCode] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const loadAccessState = useCallback(async () => {
    if (!supabase) return

    const [profileResponse, requestResponse] = await Promise.all([
      supabase
        .from('app_users')
        .select('account_status')
        .eq('user_id', userId)
        .maybeSingle(),
      supabase
        .from('access_requests')
        .select('request_status, verification_code_expires_at')
        .eq('user_id', userId)
        .maybeSingle(),
    ])

    if (profileResponse.error) throw profileResponse.error
    if (requestResponse.error) throw requestResponse.error

    setProfile(profileResponse.data as AppProfile | null)
    setAccessRequest(requestResponse.data as AccessRequest | null)
  }, [userId])

  useEffect(() => {
    let active = true

    async function load() {
      try {
        await loadAccessState()
      } catch (error) {
        console.error(error)
        if (active) setErrorMessage('利用状態を確認できませんでした。時間をおいて再度お試しください。')
      } finally {
        if (active) setIsLoading(false)
      }
    }

    void load()
    const timer = window.setInterval(() => {
      void loadAccessState().catch((error) => console.error(error))
    }, 15_000)

    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [loadAccessState])

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
    setAccessRequest({
      request_status: 'pending',
      verification_code_expires_at: result.expires_at,
    })
  }

  if (isLoading) {
    return <main className="loading-screen">利用状態を確認しています…</main>
  }

  if (profile?.account_status === 'active') {
    return (
      <Suspense fallback={<main className="loading-screen">画面を読み込んでいます…</main>}>
        <Dashboard userId={userId} onSignOut={onSignOut} />
      </Suspense>
    )
  }

  if (profile?.account_status === 'suspended') {
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

  const isPending = accessRequest?.request_status === 'pending'

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
            onClick={() => void loadAccessState()}
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
