export interface SraComment {
  id: string
  sraId: string
  authorName: string
  body: string
  createdAt: string
}

export type SraCommentsResult = {
  comments: SraComment[]
  shared: boolean
  error?: string
}

const LOCAL_KEY = 'sra-org-comments-v1'

function loadLocalAll(): SraComment[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    if (!raw) return []
    const data = JSON.parse(raw) as SraComment[]
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

function saveLocalAll(comments: SraComment[]) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(comments))
  } catch {
    // quota / private mode
  }
}

function listLocalComments(sraId: string): SraComment[] {
  return loadLocalAll()
    .filter((c) => c.sraId === sraId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

function addLocalComment(sraId: string, authorName: string, body: string): SraComment {
  const comment: SraComment = {
    id: Math.random().toString(36).slice(2, 12),
    sraId,
    authorName: authorName.trim() || 'Anonymous',
    body: body.trim(),
    createdAt: new Date().toISOString(),
  }
  saveLocalAll([comment, ...loadLocalAll()])
  return comment
}

function clearLocalCommentsForOrg(sraId: string) {
  saveLocalAll(loadLocalAll().filter((c) => c.sraId !== sraId))
}

/** Fetch shared comments from Postgres (falls back to this device if offline). */
export async function fetchSraComments(sraId: string): Promise<SraCommentsResult> {
  try {
    const res = await fetch(`/api/coherence/sra/organisation/${encodeURIComponent(sraId)}/comments`)
    const data = (await res.json()) as {
      comments?: SraComment[]
      shared?: boolean
      error?: string
    }
    if (res.ok && data.shared) {
      const remote = data.comments ?? []
      const local = listLocalComments(sraId)
      if (local.length) {
        await migrateLocalComments(sraId, local)
        const refreshed = await fetch(`/api/coherence/sra/organisation/${encodeURIComponent(sraId)}/comments`)
        if (refreshed.ok) {
          const again = (await refreshed.json()) as { comments?: SraComment[] }
          return { comments: again.comments ?? remote, shared: true }
        }
      }
      return { comments: remote, shared: true }
    }
    return {
      comments: listLocalComments(sraId),
      shared: false,
      error: data.error || `HTTP ${res.status}`,
    }
  } catch (err) {
    return {
      comments: listLocalComments(sraId),
      shared: false,
      error: err instanceof Error ? err.message : 'offline',
    }
  }
}

async function migrateLocalComments(sraId: string, local: SraComment[]) {
  for (const item of [...local].reverse()) {
    try {
      const res = await fetch(`/api/coherence/sra/organisation/${encodeURIComponent(sraId)}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authorName: item.authorName, body: item.body }),
      })
      if (res.ok) clearLocalCommentsForOrg(sraId)
    } catch {
      break
    }
  }
}

/** Post a shared comment (falls back to local storage if the API is unavailable). */
export async function postSraComment(
  sraId: string,
  authorName: string,
  body: string,
): Promise<{ comment: SraComment; shared: boolean; error?: string }> {
  const message = body.trim()
  if (!message) {
    throw new Error('Message is required')
  }

  try {
    const res = await fetch(`/api/coherence/sra/organisation/${encodeURIComponent(sraId)}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authorName, body: message }),
    })
    const data = (await res.json()) as {
      comment?: SraComment
      shared?: boolean
      error?: string
    }
    if (res.ok && data.comment) {
      return { comment: data.comment, shared: Boolean(data.shared) }
    }
    const comment = addLocalComment(sraId, authorName, message)
    return {
      comment,
      shared: false,
      error: data.error || `HTTP ${res.status}`,
    }
  } catch (err) {
    const comment = addLocalComment(sraId, authorName, message)
    return {
      comment,
      shared: false,
      error: err instanceof Error ? err.message : 'offline',
    }
  }
}
