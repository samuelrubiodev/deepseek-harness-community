/** Browser launch-token and persistent-cookie behavior. */

import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { BrowserAuth } from '../src/browser-auth.ts'
import type { ConnectionIndexRequest, ConnectionIndexResponse } from '../src/rpc.ts'
import { RecordCredentials } from './browser-credentials.ts'

function signedCookie(store: RecordCredentials, name: string, payload: unknown): string {
  const body = typeof payload === 'string'
    ? Buffer.from(payload, 'utf8').toString('base64url')
    : Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return signedBodyCookie(store, name, body)
}

function signedBodyCookie(store: RecordCredentials, name: string, body: string): string {
  const record = store.record
  if (record?.kind !== 'grant' || typeof record.payload !== 'object' || record.payload === null) {
    throw new Error('test credential store has no signing secret')
  }
  const secret: unknown = Reflect.get(record.payload, 'secret')
  if (typeof secret !== 'string') throw new Error('test credential record has no string secret')
  const signature = createHmac('sha256', Buffer.from(secret, 'base64url')).update(body).digest('base64url')
  return `${name}=v1.${body}.${signature}`
}

interface ResponseState {
  status?: number
  headers?: Readonly<Record<string, string>>
  body?: string
}

function response(): { value: ConnectionIndexResponse; state: ResponseState } {
  const state: ResponseState = {}
  return {
    value: {
      writeHead(status, headers) {
        state.status = status
        if (headers !== undefined) state.headers = headers
      },
      end(body) {
        if (body !== undefined) state.body = body
      },
    },
    state,
  }
}

function credentials(store: RecordCredentials): CredentialProvider {
  return store as unknown as CredentialProvider
}

function createAuth(
  store: RecordCredentials,
  maxAgeDays = 30,
  processOwner: object = {},
): Promise<BrowserAuth> {
  return BrowserAuth.create(processOwner, credentials(store), maxAgeDays)
}

function request(url: string, authority = '127.0.0.1:3080', init?: {
  cookie?: string
  method?: string
}): ConnectionIndexRequest {
  return {
    method: init?.method ?? 'GET',
    url,
    headers: {
      host: authority,
      ...init?.cookie === undefined ? {} : { cookie: init.cookie },
    },
  }
}

function exchange(
  auth: BrowserAuth,
  authority = '127.0.0.1:3080',
): { cookie: string; launchUrl: string; state: ResponseState } {
  const launchUrl = auth.authenticatedUrl(`http://${authority}`)
  const target = new URL(launchUrl)
  const res = response()
  expect(auth.authorizeIndex(request(`${target.pathname}${target.search}`, authority), res.value)).toBe(false)
  const setCookie = res.state.headers?.['set-cookie']
  if (setCookie === undefined) throw new Error('token exchange did not set a cookie')
  return { cookie: setCookie.split(';', 1)[0]!, launchUrl, state: res.state }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('BrowserAuth', () => {
  it('mints one process token and a persistent authority-bound cookie', async () => {
    const store = new RecordCredentials()
    const processOwner = {}
    const first = await createAuth(store, 30, processOwner)
    const login = exchange(first)

    expect(login.state).toMatchObject({
      status: 303,
      headers: {
        'cache-control': 'no-store',
        'location': '/',
        'referrer-policy': 'no-referrer',
      },
    })
    expect(login.state.headers?.['set-cookie']).toMatch(/; Max-Age=2592000; Path=\/; Expires=.*; HttpOnly; SameSite=Strict$/u)
    expect(login.state.headers?.['set-cookie']).not.toContain('Secure')
    expect(first.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: login.cookie }))).toBe(true)
    expect(first.isAuthenticated({
      headers: new Headers({ host: '127.0.0.1:3080', cookie: login.cookie }),
    })).toBe(true)
    expect(first.isAuthenticated({ headers: new Headers() })).toBe(false)
    expect(first.isAuthenticated(request('/', 'localhost:3080', { cookie: login.cookie }))).toBe(false)
    expect(first.isAuthenticated(request('/', '127.0.0.1:3081', { cookie: login.cookie }))).toBe(false)

    const reloaded = await createAuth(store, 30, processOwner)
    expect(reloaded.authenticatedUrl('http://127.0.0.1:3080')).toBe(login.launchUrl)
    expect(reloaded.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: login.cookie }))).toBe(true)

    const restarted = await createAuth(store)
    expect(new URL(restarted.authenticatedUrl('http://127.0.0.1:3080')).searchParams.get('token'))
      .not.toBe(new URL(login.launchUrl).searchParams.get('token'))
    expect(restarted.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: login.cookie }))).toBe(true)
    const staleUrl = new URL(login.launchUrl)
    const redirected = response()
    expect(restarted.authorizeIndex(request(
      `${staleUrl.pathname}${staleUrl.search}`,
      '127.0.0.1:3080',
      { cookie: login.cookie },
    ), redirected.value)).toBe(false)
    expect(redirected.state).toEqual({
      status: 303,
      headers: {
        'cache-control': 'no-store',
        'location': '/',
        'referrer-policy': 'no-referrer',
      },
    })
  })

  it('accepts the cookie for index serving and gives every unauthenticated request one response', async () => {
    const auth = await createAuth(new RecordCredentials())
    const { cookie } = exchange(auth)
    const allowed = response()
    expect(auth.authorizeIndex(request('/index.html', '127.0.0.1:3080', { cookie }), allowed.value)).toBe(true)
    expect(allowed.state).toEqual({})

    for (const candidate of [
      request('/'),
      request('/?token=wrong'),
      request('/?token=wrong&token=again'),
      request('/index.html?token=wrong'),
      request(auth.authenticatedUrl('http://127.0.0.1:3080'), '127.0.0.1:3080', { method: 'HEAD' }),
    ]) {
      const denied = response()
      expect(auth.authorizeIndex(candidate, denied.value)).toBe(false)
      expect(denied.state.status).toBe(401)
      expect(denied.state.headers).toEqual({
        'cache-control': 'no-store',
        'content-type': 'text/plain; charset=utf-8',
      })
      expect(denied.state.body).toBe(candidate.method === 'HEAD'
        ? undefined
        : 'dsh web authentication required; reopen the URL printed by dsh web.\n')
    }
  })

  it('rejects tampering, expiry, future issuance, and a longer lifetime than configured', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-24T00:00:00.000Z'))
    const store = new RecordCredentials()
    const auth = await createAuth(store)
    const { cookie } = exchange(auth)
    const [name, value] = cookie.split('=') as [string, string]

    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: `${name}=broken` }))).toBe(false)
    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: `${name}=${value.slice(0, -1)}x` }))).toBe(false)
    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: `${name}=%` }))).toBe(false)
    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', {
      cookie: signedBodyCookie(store, name, 'a'),
    }))).toBe(false)
    expect(auth.isAuthenticated({ headers: {} })).toBe(false)
    expect(auth.isAuthenticated({ headers: { host: 'bad host', cookie } })).toBe(false)
    expect(auth.isAuthenticated({ headers: { host: '127.0.0.1:3080' } })).toBe(false)

    const invalidPayloads: unknown[] = [
      'not json',
      null,
      { version: 2, authority: '127.0.0.1:3080', issuedAt: Date.now(), expiresAt: Date.now() + 1000 },
      { version: 1, authority: 42, issuedAt: Date.now(), expiresAt: Date.now() + 1000 },
      { version: 1, authority: '127.0.0.1:3080', issuedAt: 'now', expiresAt: Date.now() + 1000 },
      { version: 1, authority: '127.0.0.1:3080', issuedAt: Date.now(), expiresAt: 'later' },
    ]
    for (const payload of invalidPayloads) {
      expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', {
        cookie: signedCookie(store, name, payload),
      }))).toBe(false)
    }

    const shorter = await createAuth(store, 1)
    expect(shorter.isAuthenticated(request('/', '127.0.0.1:3080', { cookie }))).toBe(false)
    vi.setSystemTime(new Date('2026-09-24T00:00:00.000Z'))
    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie }))).toBe(false)
    vi.setSystemTime(new Date('2026-08-23T00:00:00.000Z'))
    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie }))).toBe(false)
  })

  it('loads one secret per activation and replaces it after deletion on the next activation', async () => {
    const store = new RecordCredentials()
    const auth = await createAuth(store)
    const first = exchange(auth)
    expect(store).toMatchObject({ reads: 0, modifies: 1 })

    await store.deleteRecord()
    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: first.cookie }))).toBe(true)
    const sameActivation = exchange(auth)
    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: sameActivation.cookie }))).toBe(true)
    expect(store).toMatchObject({ reads: 0, modifies: 1 })

    const reactivated = await createAuth(store)
    const second = exchange(reactivated)
    expect(second.cookie).not.toBe(first.cookie)
    expect(reactivated.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: first.cookie }))).toBe(false)
    expect(reactivated.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: second.cookie }))).toBe(true)
    expect(store).toMatchObject({ reads: 0, modifies: 2 })
  })

  it('fails loud on an invalid owner record instead of replacing it', async () => {
    const unsupported = new RecordCredentials()
    unsupported.record = { kind: 'api-key', key: 'not-a-cookie-secret' }
    await expect(createAuth(unsupported)).rejects.toThrow(/unsupported format/u)

    const malformed = new RecordCredentials()
    malformed.record = { kind: 'grant', payload: { version: 1, secret: 'short' } }
    await expect(createAuth(malformed)).rejects.toThrow(/invalid secret/u)

    const nonString = new RecordCredentials()
    nonString.record = { kind: 'grant', payload: { version: 1, secret: 42 } }
    await expect(createAuth(nonString)).rejects.toThrow(/invalid secret/u)

    const discarded = new RecordCredentials()
    discarded.discardWrites = true
    await expect(createAuth(discarded)).rejects.toThrow(/was not created/u)

    await expect(createAuth(new RecordCredentials(), Number.MAX_SAFE_INTEGER))
      .rejects.toThrow(/safe timestamp range/u)
  })

  it('binds cookie authority to X-Forwarded-Host under reverseProxy mode', async () => {
    const store = new RecordCredentials()
    const auth = await BrowserAuth.create({}, credentials(store), 30, true)
    const token = new URL(auth.authenticatedUrl('http://127.0.0.1:3080')).searchParams.get('token')
    const res = response()
    const req: ConnectionIndexRequest = {
      headers: {
        host: '127.0.0.1:3080',
        'x-forwarded-host': 'harness.lan',
        'x-forwarded-proto': 'https',
      },
      method: 'GET',
      url: `/?token=${token!}`,
    }
    const authorized = auth.authorizeIndex(req, res.value)
    expect(authorized).toBe(false)
    expect(res.state.status).toBe(303)
    const cookie = res.state.headers?.['set-cookie']
    expect(cookie).toBeDefined()

    // Subsequent request with the cookie and forwarded host succeeds
    expect(auth.isAuthenticated({
      headers: {
        host: '127.0.0.1:3080',
        'x-forwarded-host': 'harness.lan',
        'x-forwarded-proto': 'https',
        cookie: cookie!,
      },
    })).toBe(true)

    // Request without forwarded host does not match the cookie authority
    expect(auth.isAuthenticated({
      headers: {
        host: '127.0.0.1:3080',
        cookie: cookie!,
      },
    })).toBe(false)
  })

  it('provides structured diagnostic failure reasons in authenticate and logs warnings safely without leaking secrets', async () => {
    const store = new RecordCredentials()
    const warnings: string[] = []
    const logger = { warn: (msg: string) => { warnings.push(msg) } }
    const auth = await BrowserAuth.create({}, credentials(store), 30, false, logger)
    const { cookie, launchUrl } = exchange(auth)
    const launchToken = new URL(launchUrl).searchParams.get('token')!

    // Missing authority
    const noHost = auth.authenticate({ headers: {} })
    expect(noHost).toEqual({
      authenticated: false,
      reason: 'missing or unparseable request authority (Host)',
    })

    // Missing Cookie header
    const noCookieHeader = auth.authenticate(request('/', '127.0.0.1:3080'))
    expect(noCookieHeader).toEqual({
      authenticated: false,
      reason: 'missing Cookie header for authority "127.0.0.1:3080"',
    })

    // Missing cookie for this specific authority
    const wrongCookieName = auth.authenticate(request('/', '127.0.0.1:3080', { cookie: 'other-cookie=123' }))
    expect(wrongCookieName).toEqual({
      authenticated: false,
      reason: 'missing session cookie for authority "127.0.0.1:3080"',
    })

    // Invalid cookie signature
    const [name] = cookie.split('=') as [string, string]
    const tampered = auth.authenticate(request('/', '127.0.0.1:3080', { cookie: `${name}=broken` }))
    expect(tampered).toEqual({
      authenticated: false,
      reason: 'invalid or unparseable session cookie signature for authority "127.0.0.1:3080"',
    })

    // Authority mismatch
    const mismatch = auth.authenticate(request('/', 'localhost:3080', { cookie }))
    expect(mismatch.authenticated).toBe(false)
    if (!mismatch.authenticated) {
      expect(mismatch.reason).toMatch(/missing session cookie for authority "localhost:3080"/)
    }

    // Authority mismatch with manually crafted cookie payload signed by valid secret
    const otherAuthorityCookie = signedCookie(store, name, {
      version: 1,
      authority: 'other.domain:3080',
      issuedAt: Date.now(),
      expiresAt: Date.now() + 100000,
    })
    const payloadMismatch = auth.authenticate(request('/', '127.0.0.1:3080', { cookie: otherAuthorityCookie }))
    expect(payloadMismatch).toEqual({
      authenticated: false,
      reason: 'session cookie authority mismatch ("other.domain:3080" vs "127.0.0.1:3080")',
    })

    // Expired cookie
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-24T00:00:00.000Z'))
    const authTimed = await BrowserAuth.create({}, credentials(store), 1, false, logger)
    const { cookie: timedCookie } = exchange(authTimed)
    vi.setSystemTime(new Date('2026-08-26T00:00:00.000Z'))
    const expired = authTimed.authenticate(request('/', '127.0.0.1:3080', { cookie: timedCookie }))
    expect(expired.authenticated).toBe(false)
    if (!expired.authenticated) {
      expect(expired.reason).toMatch(/session cookie expired at/)
    }
    vi.useRealTimers()

    // Future issuedAt
    const futureCookie = signedCookie(store, name, {
      version: 1,
      authority: '127.0.0.1:3080',
      issuedAt: Date.now() + 100000,
      expiresAt: Date.now() + 200000,
    })
    const future = auth.authenticate(request('/', '127.0.0.1:3080', { cookie: futureCookie }))
    expect(future.authenticated).toBe(false)
    if (!future.authenticated) {
      expect(future.reason).toMatch(/session cookie issued in the future/)
    }

    // authorizeIndex diagnostic logging
    warnings.length = 0

    // 1. Invalid launch token
    const res1 = response()
    auth.authorizeIndex(request('/?token=invalid_secret_token_12345'), res1.value)
    expect(res1.state.status).toBe(401)
    expect(warnings).toContain('client-connection: index authorization failed (401): invalid launch token')
    // CRITICAL: Ensure the provided token value was NEVER logged
    expect(warnings.join('\n')).not.toContain('invalid_secret_token_12345')
    expect(warnings.join('\n')).not.toContain(launchToken)

    // 2. Multiple tokens
    warnings.length = 0
    const res2 = response()
    auth.authorizeIndex(request('/?token=tok1&token=tok2'), res2.value)
    expect(res2.state.status).toBe(401)
    expect(warnings).toContain('client-connection: index authorization failed (401): multiple launch tokens provided in query')
    expect(warnings.join('\n')).not.toContain('tok1')
    expect(warnings.join('\n')).not.toContain('tok2')

    // 3. Non-GET method with token
    warnings.length = 0
    const res3 = response()
    auth.authorizeIndex(request(`/?token=${launchToken}`, '127.0.0.1:3080', { method: 'POST' }), res3.value)
    expect(res3.state.status).toBe(401)
    expect(warnings).toContain('client-connection: index authorization failed (401): method "POST" is not GET')
    expect(warnings.join('\n')).not.toContain(launchToken)

    // 4. Non-root path with token
    warnings.length = 0
    const res4 = response()
    auth.authorizeIndex(request(`/other?token=${launchToken}`, '127.0.0.1:3080'), res4.value)
    expect(res4.state.status).toBe(401)
    expect(warnings).toContain('client-connection: index authorization failed (401): pathname "/other" is not root (/)')
    expect(warnings.join('\n')).not.toContain(launchToken)

    // 5. Missing cookie on index request
    warnings.length = 0
    const res5 = response()
    auth.authorizeIndex(request('/'), res5.value)
    expect(res5.state.status).toBe(401)
    expect(warnings).toContain('client-connection: index authorization failed (401): missing Cookie header for authority "127.0.0.1:3080"')
  })

  it('logs consecutive identical index rejections once while still answering every request with 401', async () => {
    const store = new RecordCredentials()
    const warnings: string[] = []
    const auth = await BrowserAuth.create({}, credentials(store), 30, false, { warn: (msg) => { warnings.push(msg) } })

    // The health probe challenges / without a Cookie repeatedly; only the first
    // occurrence of a reason is logged, but every request still gets its 401.
    for (let probe = 0; probe < 3; probe++) {
      const res = response()
      expect(auth.authorizeIndex(request('/'), res.value)).toBe(false)
      expect(res.state.status).toBe(401)
    }
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('missing Cookie header for authority "127.0.0.1:3080"')

    // A different reason is logged and becomes the new suppression baseline.
    const other = response()
    auth.authorizeIndex(request('/', '192.168.1.10:3080'), other.value)
    expect(other.state.status).toBe(401)
    expect(warnings).toHaveLength(2)

    // After the reason changes, a repeat of the first one logs again.
    const again = response()
    auth.authorizeIndex(request('/'), again.value)
    expect(again.state.status).toBe(401)
    expect(warnings).toHaveLength(3)
  })

  it('accepts a fixed token across instances and keeps the cookie flow', async () => {
    const store = new RecordCredentials()
    const first = await BrowserAuth.create({}, credentials(store), 30, false, undefined, { fixedToken: 'my-stable-token' })
    const second = await BrowserAuth.create({}, credentials(store), 30, false, undefined, { fixedToken: 'my-stable-token' })

    const url = first.authenticatedUrl('http://192.168.1.10:3080')
    expect(new URL(url).searchParams.get('token')).toBe('my-stable-token')
    // The same URL mints a session on ANY instance: restarts never invalidate it.
    const login = response()
    expect(second.authorizeIndex(request('/?token=my-stable-token', '192.168.1.10:3080'), login.value)).toBe(false)
    expect(login.state.status).toBe(303)
    const cookie = login.state.headers?.['set-cookie']!.split(';', 1)[0]!
    expect(second.isAuthenticated(request('/', '192.168.1.10:3080', { cookie }))).toBe(true)

    // Wrong fixed tokens still reject.
    const bad = response()
    expect(first.authorizeIndex(request('/?token=guess', '192.168.1.10:3080'), bad.value)).toBe(false)
    expect(bad.state.status).toBe(401)
  })

  it('serves index and authenticates requests without token or cookie in none mode', async () => {
    const store = new RecordCredentials()
    const auth = await BrowserAuth.create({}, credentials(store), 30, false, undefined, { mode: 'none' })

    expect(auth.authenticatedUrl('http://192.168.1.10:3080')).toBe('http://192.168.1.10:3080/')
    const res = response()
    expect(auth.authorizeIndex(request('/'), res.value)).toBe(true)
    expect(res.state.status).toBeUndefined()
    expect(auth.isAuthenticated(request('/'))).toBe(true)
    expect(auth.authenticate({ headers: {} })).toEqual({ authenticated: true })
  })
})
