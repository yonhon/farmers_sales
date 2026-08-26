import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'

import { AccessGate } from './components/AccessGate'
import { Login } from './components/Login'
import { isSupabaseConfigured, supabase } from './lib/supabase'

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [authErrorMessage, setAuthErrorMessage] = useState('')

  useEffect(() => {
    if (!supabase) {
      setSession(null)
      return
    }

    const callbackParams = new URLSearchParams(window.location.search)
    const callbackError = callbackParams.get('error_description')
      ?? callbackParams.get('error')
    const callbackErrorCode = callbackParams.get('error_code')

    if (callbackError) {
      const errorCodeSuffix = callbackErrorCode ? `（${callbackErrorCode}）` : ''
      setAuthErrorMessage(`LINEログインに失敗しました${errorCodeSuffix}: ${callbackError}`)
    }

    void supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        console.error(error)
        if (!callbackError) {
          setAuthErrorMessage('ログイン結果を確認できませんでした。もう一度LINEログインをお試しください。')
        }
      } else if (!data.session && callbackParams.has('code')) {
        setAuthErrorMessage('LINE認証は完了しましたが、ログイン状態を保存できませんでした。もう一度お試しください。')
      }
      setSession(data.session)
    })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (nextSession) setAuthErrorMessage('')
      setSession(nextSession)
    })

    return () => subscription.unsubscribe()
  }, [])

  if (!isSupabaseConfigured) {
    return (
      <main className="configuration-shell">
        <section className="configuration-card">
          <p className="eyebrow">CONFIGURATION REQUIRED</p>
          <h1>Supabaseの接続設定が必要です</h1>
          <p>
            <code>VITE_SUPABASE_URL</code>と
            <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>を設定してください。
          </p>
        </section>
      </main>
    )
  }

  if (session === undefined) {
    return <main className="loading-screen">認証状態を確認しています…</main>
  }

  if (!session) return <Login authErrorMessage={authErrorMessage} />

  const suggestedDisplayName = String(
    session.user.user_metadata.name
      ?? session.user.user_metadata.full_name
      ?? session.user.email
      ?? '',
  )

  return (
    <AccessGate
      userId={session.user.id}
      suggestedDisplayName={suggestedDisplayName}
      onSignOut={async () => {
        await supabase?.auth.signOut()
      }}
    />
  )
}
