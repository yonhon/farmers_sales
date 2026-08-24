import { lazy, Suspense, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'

import { Login } from './components/Login'
import { isSupabaseConfigured, supabase } from './lib/supabase'

const Dashboard = lazy(() =>
  import('./components/Dashboard').then((module) => ({
    default: module.Dashboard,
  })),
)

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    if (!supabase) {
      setSession(null)
      return
    }

    void supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
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

  if (!session) return <Login />

  return (
    <Suspense fallback={<main className="loading-screen">画面を読み込んでいます…</main>}>
      <Dashboard
        userEmail={session.user.email ?? 'ログインユーザー'}
        onSignOut={async () => {
          await supabase?.auth.signOut()
        }}
      />
    </Suspense>
  )
}
