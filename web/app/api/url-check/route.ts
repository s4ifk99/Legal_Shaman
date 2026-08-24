import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED = new Set([
  'www.citizensadvice.org.uk',
  'citizensadvice.org.uk',
  'www.gov.uk',
  'gov.uk',
  'www.legislation.gov.uk',
  'legislation.gov.uk',
  'www.acas.org.uk',
  'acas.org.uk',
  'www.popla.co.uk',
  'popla.co.uk',
  'www.britishparking.co.uk',
  'britishparking.co.uk',
  'www.ico.org.uk',
  'ico.org.uk',
  'www.moneyhelper.org.uk',
  'moneyhelper.org.uk',
  'england.shelter.org.uk',
  'www.shelter.org.uk',
  'www.nhs.uk',
  'nhs.uk',
])

function hostAllowed(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return ALLOWED.has(h) || [...ALLOWED].some((d) => h === d || h.endsWith('.' + d))
}

export async function GET(req: Request) {
  const target = new URL(req.url).searchParams.get('url') || ''
  if (!/^https:\/\//i.test(target)) {
    return NextResponse.json({ ok: false, error: 'https-only' }, { status: 400 })
  }

  let hostname: string
  try {
    hostname = new URL(target).hostname
  } catch {
    return NextResponse.json({ ok: false, error: 'bad-url' }, { status: 400 })
  }

  if (!hostAllowed(hostname)) {
    return NextResponse.json({ ok: true, status: 0, unchecked: true })
  }

  try {
    const upstream = await fetch(target, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'LegalShaman-URLCheck/1.0', Accept: '*/*' },
    })
    let status = upstream.status
    if (status === 405 || status === 403 || status === 0) {
      const get = await fetch(target, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
        headers: {
          'User-Agent': 'LegalShaman-URLCheck/1.0',
          Accept: 'text/html',
          Range: 'bytes=0-0',
        },
      })
      status = get.status
    }
    return NextResponse.json({ ok: status >= 200 && status < 400, status })
  } catch (err) {
    return NextResponse.json({
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : 'check-failed',
    })
  }
}
