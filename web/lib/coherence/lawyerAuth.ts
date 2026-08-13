/**
 * Phase 4 — solicitor auth (local trial).
 * Lay clients never see the lawyer portal; only signed-in solicitors do.
 *
 * This is a front-end trial store (localStorage). Replace with real auth
 * before production — passwords are salted SHA-256, not a bank vault.
 */

export type LawyerAccount = {
  id: string
  email: string
  displayName: string
  /** hex SHA-256(salt + password) */
  passwordHash: string
  salt: string
  createdAt: string
}

export type LawyerSession = {
  accountId: string
  email: string
  displayName: string
  signedInAt: string
}

const ACCOUNTS_KEY = 'coherence-intake-lawyer-accounts-v1'
const SESSION_KEY = 'coherence-intake-lawyer-session-v1'

function nowIso() {
  return new Date().toISOString()
}

function newId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `lawyer-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function randomSalt() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function hashPassword(password: string, salt: string): Promise<string> {
  return sha256Hex(`${salt}:${password}`)
}

function loadAccounts(): LawyerAccount[] {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY)
    if (!raw) return []
    const data = JSON.parse(raw) as LawyerAccount[]
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

function saveAccounts(accounts: LawyerAccount[]) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts))
}

export function loadLawyerSession(): LawyerSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as LawyerSession
    if (!data?.accountId || !data?.email) return null
    return data
  } catch {
    return null
  }
}

function saveLawyerSession(session: LawyerSession) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export function clearLawyerSession() {
  try {
    localStorage.removeItem(SESSION_KEY)
  } catch {
    // ignore
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function validateLawyerSignup(input: {
  email: string
  password: string
  displayName: string
}): string[] {
  const errors: string[] = []
  const email = normalizeEmail(input.email)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Enter a valid work email.')
  if (input.displayName.trim().length < 2) errors.push('Enter your name as it should appear on reviews.')
  if (input.password.length < 8) errors.push('Password must be at least 8 characters.')
  return errors
}

export async function signUpLawyer(input: {
  email: string
  password: string
  displayName: string
}): Promise<{ ok: true; session: LawyerSession } | { ok: false; error: string }> {
  const errors = validateLawyerSignup(input)
  if (errors.length) return { ok: false, error: errors[0] }

  const email = normalizeEmail(input.email)
  const accounts = loadAccounts()
  if (accounts.some((a) => a.email === email)) {
    return { ok: false, error: 'An account with that email already exists. Sign in instead.' }
  }

  const salt = randomSalt()
  const passwordHash = await hashPassword(input.password, salt)
  const account: LawyerAccount = {
    id: newId(),
    email,
    displayName: input.displayName.trim(),
    passwordHash,
    salt,
    createdAt: nowIso(),
  }
  saveAccounts([...accounts, account])

  const session: LawyerSession = {
    accountId: account.id,
    email: account.email,
    displayName: account.displayName,
    signedInAt: nowIso(),
  }
  saveLawyerSession(session)
  return { ok: true, session }
}

export async function signInLawyer(input: {
  email: string
  password: string
}): Promise<{ ok: true; session: LawyerSession } | { ok: false; error: string }> {
  const email = normalizeEmail(input.email)
  if (!email || !input.password) return { ok: false, error: 'Email and password required.' }

  const account = loadAccounts().find((a) => a.email === email)
  if (!account) return { ok: false, error: 'No solicitor account for that email. Sign up first.' }

  const passwordHash = await hashPassword(input.password, account.salt)
  if (passwordHash !== account.passwordHash) {
    return { ok: false, error: 'Incorrect password.' }
  }

  const session: LawyerSession = {
    accountId: account.id,
    email: account.email,
    displayName: account.displayName,
    signedInAt: nowIso(),
  }
  saveLawyerSession(session)
  return { ok: true, session }
}

export function signOutLawyer() {
  clearLawyerSession()
}

/** Pure helpers for Node tests (no crypto.subtle). */
export function validateLawyerSignupSync(input: {
  email: string
  password: string
  displayName: string
}): string[] {
  return validateLawyerSignup(input)
}
