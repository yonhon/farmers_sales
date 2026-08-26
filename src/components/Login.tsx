import { type FormEvent, useState } from 'react'

import { supabase } from '../lib/supabase'

export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return

    setIsSubmitting(true)
    setErrorMessage('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setIsSubmitting(false)

    if (error) {
      setErrorMessage('メールアドレスまたはパスワードを確認してください。')
    }
  }

  async function handleLineLogin() {
    if (!supabase) return

    setIsSubmitting(true)
    setErrorMessage('')
    const redirectTo = new URL(import.meta.env.BASE_URL, window.location.origin).toString()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'custom:line',
      options: { redirectTo },
    })

    if (error) {
      setIsSubmitting(false)
      setErrorMessage('LINEログインを開始できませんでした。管理者へお問い合わせください。')
    }
  }

  return (
    <main className="login-shell">
      <section className="login-intro" aria-labelledby="login-title">
        <p className="eyebrow">NODAI FARMERS MARKET</p>
          <h1 id="login-title">収穫から販売まで、売上データをひと目で把握。</h1>
        <p>
          日々の販売を見渡し、次の出荷判断につなげるためのダッシュボードです。
        </p>
        <div className="harvest-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </section>

      <section className="login-card" aria-label="ログインフォーム">
        <div>
          <p className="section-kicker">MEMBER SIGN IN</p>
          <h2>販売ダッシュボード</h2>
          <p className="muted">初めての方も、登録済みの方もLINEからお進みください。</p>
        </div>

        <div className="login-options">
          <button
            className="line-login-button"
            type="button"
            disabled={isSubmitting}
            onClick={() => void handleLineLogin()}
          >
            <span aria-hidden="true">LINE</span>
            {isSubmitting ? 'LINEへ移動中…' : 'LINEで登録・ログイン'}
          </button>

          {errorMessage && <p className="form-error" role="alert">{errorMessage}</p>}

          <details className="admin-login">
            <summary>管理者用ログイン</summary>
            <form onSubmit={handleSubmit}>
              <label>
                メールアドレス
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                />
              </label>
              <label>
                パスワード
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
              <button className="primary-button" type="submit" disabled={isSubmitting}>
                {isSubmitting ? '確認中…' : 'メールでログイン'}
              </button>
            </form>
          </details>
        </div>
      </section>
    </main>
  )
}
