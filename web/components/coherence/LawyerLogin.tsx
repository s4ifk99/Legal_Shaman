import { useState, type FormEvent } from 'react'
import {
  normalizeEmail,
  signInLawyer,
  signUpLawyer,
  type LawyerSession,
} from '@/lib/coherence/lawyerAuth'
import './LawyerLogin.css'

interface Props {
  onSignedIn: (session: LawyerSession) => void
  onBackToClient: () => void
}

type Mode = 'signin' | 'signup'

export function LawyerLogin({ onSignedIn, onBackToClient }: Props) {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const result =
        mode === 'signup'
          ? await signUpLawyer({ email, password, displayName })
          : await signInLawyer({ email, password })
      if (!result.ok) {
        setError(result.error)
        return
      }
      onSignedIn(result.session)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="lawyer-login">
      <header className="lawyer-login__chrome">
        <button type="button" className="lawyer-login__back" onClick={onBackToClient}>
          ← Client intake
        </button>
        <span className="lawyer-login__brand">Legal Shaman · Solicitor</span>
      </header>

      <main className="lawyer-login__main">
        <h1 className="lawyer-login__title">
          {mode === 'signin' ? 'Solicitor sign in' : 'Solicitor sign up'}
        </h1>
        <p className="lawyer-login__lead">
          Lawyer review and gold corrections are only available after you sign in. Lay clients never
          see this screen.
        </p>

        <form className="lawyer-login__form" onSubmit={(e) => void submit(e)}>
          {mode === 'signup' && (
            <label className="lawyer-login__field">
              <span>Name</span>
              <input
                type="text"
                autoComplete="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
              />
            </label>
          )}
          <label className="lawyer-login__field">
            <span>Work email</span>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(normalizeEmail(e.target.value))}
              required
            />
          </label>
          <label className="lawyer-login__field">
            <span>Password</span>
            <input
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </label>

          {error && (
            <p className="lawyer-login__error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="lawyer-login__submit" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p className="lawyer-login__switch">
          {mode === 'signin' ? (
            <>
              New to the platform?{' '}
              <button type="button" onClick={() => { setMode('signup'); setError(null) }}>
                Sign up
              </button>
            </>
          ) : (
            <>
              Already registered?{' '}
              <button type="button" onClick={() => { setMode('signin'); setError(null) }}>
                Sign in
              </button>
            </>
          )}
        </p>

        <p className="lawyer-login__trial-note">
          Trial auth is stored in this browser only. Production will use the firm identity provider.
        </p>
      </main>
    </div>
  )
}
