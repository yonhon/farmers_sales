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

  return (
    <main className="login-shell">
      <section className="login-intro" aria-labelledby="login-title">
        <p className="eyebrow">NODAI FARMERS MARKET</p>
        <h1 id="login-title">畑から売り場まで、数字をひとつに。</h1>
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
          <p className="muted">登録済みのSupabase Authアカウントでログインします。</p>
        </div>

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
          {errorMessage && <p className="form-error" role="alert">{errorMessage}</p>}
          <button className="primary-button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? '確認中…' : 'ログイン'}
          </button>
        </form>
      </section>
    </main>
  )
}
