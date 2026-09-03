/** Browser-session authentication for the Host Connection carrier. */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type {
  ConnectionIndexRequest,
  ConnectionIndexResponse,
  ConnectionTrustRequest,
} from './rpc.ts'
import { firstHeaderSegment, header } from './api-request-trust.ts'

const AUTH_RECORD_KEY = credentialKey('client-connection', 'browser-session')
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000
const SECRET_BYTES = 32
const TOKEN_QUERY = 'token'
const COOKIE_PREFIX = 'dsh-auth-'
const COOKIE_PAYLOAD_VERSION = 1
const STORED_SECRET_VERSION = 1
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/
const PROCESS_LAUNCH_TOKENS = new WeakMap<object, string>()

interface StoredSecretPayload {
  readonly version: typeof STORED_SECRET_VERSION
  readonly secret: string
}

interface BrowserCookiePayload {
  readonly version: typeof COOKIE_PAYLOAD_VERSION
  readonly authority: string
  readonly issuedAt: number
  readonly expiresAt: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function encodeBase64Url(value: Uint8Array): string {
  return Buffer.from(value).toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')
}

function decodeBase64Url(value: string): Buffer | undefined {
  if (!BASE64URL_PATTERN.test(value) || value.length % 4 === 1) return undefined
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const decoded = Buffer.from(value.replaceAll('-', '+').replaceAll('_', '/') + padding, 'base64')
  return encodeBase64Url(decoded) === value ? decoded : undefined
}

function processLaunchToken(owner: object): string {
  const existing = PROCESS_LAUNCH_TOKENS.get(owner)
  if (existing !== undefined) return existing
  const created = encodeBase64Url(randomBytes(SECRET_BYTES))
  PROCESS_LAUNCH_TOKENS.set(owner, created)
  return created
}

/** Canonical request authority used as the cookie name and signed audience. */
function requestAuthority(headers: ConnectionTrustRequest['headers'], reverseProxy: boolean = false): string | undefined {
  const forwarded = reverseProxy ? firstHeaderSegment(header(headers, 'x-forwarded-host')) : undefined
  const host = forwarded ?? header(headers, 'host')
  if (host === undefined) return undefined
  const proto = (reverseProxy ? firstHeaderSegment(header(headers, 'x-forwarded-proto')) : undefined) ?? 'http'
  try {
    return new URL(`${proto}://${host}`).host
  } catch {
    return undefined
  }
}

function canonicalSecret(value: unknown): Buffer | undefined {
  if (typeof value !== 'string') return undefined
  const decoded = decodeBase64Url(value)
  if (decoded === undefined || decoded.byteLength !== SECRET_BYTES) return undefined
  return decoded
}

function storedSecret(record: CredentialRecord | undefined): Buffer | undefined {
  if (record === undefined) return undefined
  if (record.kind !== 'grant' || !isRecord(record.payload)
    || record.payload.version !== STORED_SECRET_VERSION) {
    throw new Error('client-connection: browser-session credential record has an unsupported format')
  }
  const secret = canonicalSecret(record.payload.secret)
  if (secret === undefined) {
    throw new Error('client-connection: browser-session credential record has an invalid secret')
  }
  return secret
}

function tokenMatches(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual, 'utf8')
  const expectedBytes = Buffer.from(expected, 'utf8')
  return actualBytes.byteLength === expectedBytes.byteLength && timingSafeEqual(actualBytes, expectedBytes)
}

function cookieName(authority: string): string {
  return COOKIE_PREFIX + encodeBase64Url(createHash('sha256').update(authority).digest())
}

/** Read the exact generated cookie without implementing general Cookie decoding. */
function cookieValue(headerValue: string, name: string): string | undefined {
  for (const segment of headerValue.split(';')) {
    const at = segment.indexOf('=')
    if (at === -1 || segment.slice(0, at).trim() !== name) continue
    return segment.slice(at + 1).trim()
  }
  return undefined
}

/** Serialize the fixed browser-session attributes; generated names and values are cookie-safe base64url. */
function sessionCookie(name: string, value: string, expiresAt: number, maxAgeSeconds: number): string {
  return `${name}=${value}; Max-Age=${String(maxAgeSeconds)}; Path=/; Expires=${new Date(expiresAt).toUTCString()}; HttpOnly; SameSite=Strict`
}

function signature(secret: Buffer, body: string): Buffer {
  return createHmac('sha256', secret).update(body).digest()
}

function encodeCookie(payload: BrowserCookiePayload, secret: Buffer): string {
  const body = encodeBase64Url(Buffer.from(JSON.stringify(payload), 'utf8'))
  return `v1.${body}.${encodeBase64Url(signature(secret, body))}`
}

function decodeCookie(value: string, secret: Buffer): BrowserCookiePayload | undefined {
  const parts = value.split('.')
  const [version, body, encodedSignature] = parts
  if (parts.length !== 3 || version !== 'v1' || body === undefined || encodedSignature === undefined) {
    return undefined
  }
  const actualSignature = decodeBase64Url(encodedSignature)
  if (actualSignature === undefined) return undefined
  const expectedSignature = signature(secret, body)
  if (actualSignature.byteLength !== expectedSignature.byteLength
    || !timingSafeEqual(actualSignature, expectedSignature)) return undefined
  let decoded: unknown
  try {
    const bodyBytes = decodeBase64Url(body)
    if (bodyBytes === undefined) return undefined
    decoded = JSON.parse(bodyBytes.toString('utf8'))
  } catch {
    return undefined
  }
  if (!isRecord(decoded)
    || decoded.version !== COOKIE_PAYLOAD_VERSION
    || typeof decoded.authority !== 'string'
    || !Number.isSafeInteger(decoded.issuedAt)
    || !Number.isSafeInteger(decoded.expiresAt)) return undefined
  return decoded as unknown as BrowserCookiePayload
}

async function initializeSecret(credentials: CredentialProvider): Promise<Buffer> {
  const generated: StoredSecretPayload = {
    version: STORED_SECRET_VERSION,
    secret: encodeBase64Url(randomBytes(SECRET_BYTES)),
  }
  const record = await credentials.modifyRecord(AUTH_RECORD_KEY, (current) => {
    if (current !== undefined) {
      storedSecret(current)
      return Promise.resolve(undefined)
    }
    return Promise.resolve({ kind: 'grant', payload: generated })
  })
  const secret = storedSecret(record)
  if (secret === undefined) {
    throw new Error('client-connection: browser-session credential record was not created')
  }
  return secret
}

/** How a request proves it may reach the browser UI and its API. */
export type BrowserAuthMode = 'token' | 'none'

/** Deployment choices layered over the process launch-token exchange. */
export interface BrowserAuthOptions {
  /**
   * `token` (default) requires the launch-token exchange and a signed
   * session cookie. `none` serves the index and authenticates every request
   * that passes the Host/Origin trust fence without any token or cookie.
   */
  mode?: BrowserAuthMode
  /**
   * Fixed access token accepted at `/?token=<value>`, replacing the random
   * per-process launch token so the sign-in URL survives restarts. Must not
   * appear in logs or error output.
   */
  fixedToken?: string
}

/** Result of verifying browser session authentication. */
export type BrowserAuthResult =
  | { readonly authenticated: true }
  | { readonly authenticated: false; readonly reason: string }

/** Logger interface accepted by BrowserAuth for diagnostic warning emissions. */
export interface BrowserAuthLogger {
  warn: (message: string, ...args: unknown[]) => void
}

/**
 * Process launch-token exchange and persistent signed-cookie verification.
 * Connection loads the credential provider's signing secret during activation
 * and retains it for synchronous request authentication.
 */
export class BrowserAuth {
  private readonly launchToken: string
  private readonly maxAgeMilliseconds: number
  private readonly mode: BrowserAuthMode
  /** Last written 401 diagnostic; identical consecutive repeats stay silent. */
  private lastIndexRejection: string | undefined
  private constructor(
    processOwner: object,
    private readonly secret: Buffer,
    maxAgeDays: number,
    private readonly reverseProxy: boolean = false,
    private readonly logger?: BrowserAuthLogger,
    options: BrowserAuthOptions = {},
  ) {
    this.mode = options.mode ?? 'token'
    this.launchToken = options.fixedToken ?? processLaunchToken(processOwner)
    this.maxAgeMilliseconds = maxAgeDays * DAY_MILLISECONDS
    if (!Number.isSafeInteger(this.maxAgeMilliseconds)
      || !Number.isSafeInteger(Date.now() + this.maxAgeMilliseconds)) {
      throw new Error('client-connection: cookieMaxAgeDays exceeds the safe timestamp range')
    }
  }

  /**
   * Initialize browser authentication and create its durable signing secret
   * when this Harness home has none.
   * @param processOwner - root application context retaining one token across Connection reloads.
   * @param credentials - persistent credential provider for the Web profile.
   * @param maxAgeDays - positive absolute browser-cookie lifetime in days.
   * @param reverseProxy - whether to trust reverse-proxy headers for authority resolution.
   * @param logger - optional logger for diagnostic authentication warnings.
   * @param options - authentication mode and optional fixed access token.
   * @returns initialized authentication owner with the process or fixed launch token.
   */
  static async create(
    processOwner: object,
    credentials: CredentialProvider,
    maxAgeDays: number,
    reverseProxy: boolean = false,
    logger?: BrowserAuthLogger,
    options: BrowserAuthOptions = {},
  ): Promise<BrowserAuth> {
    return new BrowserAuth(
      processOwner, await initializeSecret(credentials), maxAgeDays, reverseProxy, logger, options,
    )
  }
  /**
   * Add this process's launch token to the ordinary application root URL.
   * @param baseUrl - canonical browser origin without credentials.
   * @returns root URL carrying the process or fixed token, or the clean URL
   * when authentication is disabled.
   */
  authenticatedUrl(baseUrl: string): string {
    const url = new URL(baseUrl)
    url.pathname = '/'
    url.search = ''
    url.hash = ''
    if (this.mode === 'none') return url.href
    url.searchParams.set(TOKEN_QUERY, this.launchToken)
    return url.href
  }

  /**
   * Authenticate an index request. A valid root query token mints the cookie
   * and redirects to clean `/`; a valid cookie lets the caller serve the
   * index; every other request receives the same minimal 401 response.
   * @param req - incoming root or configured-index request.
   * @param res - response owned when this method returns false.
   * @returns true only when the caller may serve index.html.
   */
  authorizeIndex(req: ConnectionIndexRequest, res: ConnectionIndexResponse): boolean {
    if (this.mode === 'none') return true
    /* v8 ignore next -- node:http always supplies url on server requests. */
    const url = new URL(req.url ?? '/', 'http://dsh.invalid')
    const tokens = url.searchParams.getAll(TOKEN_QUERY)
    if (tokens.length > 0) {
      const authority = requestAuthority(req.headers, this.reverseProxy)
      if (req.method === 'GET' && url.pathname === '/' && tokens.length === 1
        && authority !== undefined && tokenMatches(tokens.join(''), this.launchToken)) {
        const issuedAt = Date.now()
        const expiresAt = issuedAt + this.maxAgeMilliseconds
        const value = encodeCookie({
          version: COOKIE_PAYLOAD_VERSION,
          authority,
          issuedAt,
          expiresAt,
        }, this.secret)
        res.writeHead(303, {
          'cache-control': 'no-store',
          'location': '/',
          'referrer-policy': 'no-referrer',
          'set-cookie': sessionCookie(
            cookieName(authority), value, expiresAt, Math.floor(this.maxAgeMilliseconds / 1000),
          ),
        })
        res.end()
        return false
      }
      if (req.method === 'GET' && url.pathname === '/' && this.isAuthenticated(req)) {
        res.writeHead(303, {
          'cache-control': 'no-store',
          'location': '/',
          'referrer-policy': 'no-referrer',
        })
        res.end()
        return false
      }
      let failureReason = 'invalid launch token'
      if (tokens.length > 1) {
        failureReason = 'multiple launch tokens provided in query'
      } else if (req.method !== 'GET') {
        failureReason = `method "${req.method}" is not GET`
      } else if (url.pathname !== '/') {
        failureReason = `pathname "${url.pathname}" is not root (/)`
      } else if (authority === undefined) {
        failureReason = 'missing or unparseable request authority (Host)'
      }
      this.writeUnauthorized(req, res, failureReason)
      return false
    }
    const auth = this.authenticate(req)
    if (auth.authenticated) return true
    this.writeUnauthorized(req, res, auth.reason)
    return false
  }

  /**
   * Verify the authority-bound browser cookie on a Host request with detailed failure diagnostic reason.
   * @param request - request headers carrying Host and Cookie.
   * @returns detailed authentication result.
   */
  authenticate(request: ConnectionTrustRequest): BrowserAuthResult {
    if (this.mode === 'none') return { authenticated: true }
    const authority = requestAuthority(request.headers, this.reverseProxy)
    if (authority === undefined) {
      return { authenticated: false, reason: 'missing or unparseable request authority (Host)' }
    }
    const rawCookie = header(request.headers, 'cookie')
    if (rawCookie === undefined) {
      return { authenticated: false, reason: `missing Cookie header for authority "${authority}"` }
    }
    const value = cookieValue(rawCookie, cookieName(authority))
    if (value === undefined) {
      return { authenticated: false, reason: `missing session cookie for authority "${authority}"` }
    }
    const payload = decodeCookie(value, this.secret)
    if (payload === undefined) {
      return { authenticated: false, reason: `invalid or unparseable session cookie signature for authority "${authority}"` }
    }
    if (payload.authority !== authority) {
      return { authenticated: false, reason: `session cookie authority mismatch ("${payload.authority}" vs "${authority}")` }
    }
    const now = Date.now()
    if (payload.issuedAt > now) {
      return { authenticated: false, reason: `session cookie issued in the future (issuedAt: ${String(payload.issuedAt)}, now: ${String(now)})` }
    }
    if (payload.expiresAt <= now) {
      return { authenticated: false, reason: `session cookie expired at ${new Date(payload.expiresAt).toISOString()} (now: ${new Date(now).toISOString()})` }
    }
    if (payload.expiresAt <= payload.issuedAt || payload.expiresAt - payload.issuedAt > this.maxAgeMilliseconds) {
      return { authenticated: false, reason: 'session cookie has invalid lifetime bounds' }
    }
    return { authenticated: true }
  }

  /**
   * Verify the authority-bound browser cookie on a Host request.
   * @param request - request headers carrying Host and Cookie.
   * @returns true only for an unexpired cookie signed by this activation's loaded secret.
   */
  isAuthenticated(request: ConnectionTrustRequest): boolean {
    return this.authenticate(request).authenticated
  }

  private writeUnauthorized(req: ConnectionIndexRequest, res: ConnectionIndexResponse, reason?: string): void {
    // Health probes re-challenge `/` every interval with the same reason; only
    // the first occurrence of each consecutive diagnostic is worth logging.
    if (reason !== undefined && reason !== this.lastIndexRejection) {
      this.lastIndexRejection = reason
      if (this.logger !== undefined) {
        this.logger.warn(`client-connection: index authorization failed (401): ${reason}`)
      }
      console.warn(`[client-connection] index authorization failed (401): ${reason}`)
    }
    res.writeHead(401, {
      'cache-control': 'no-store',
      'content-type': 'text/plain; charset=utf-8',
    })
    res.end(req.method === 'HEAD'
      ? undefined
      : 'dsh web authentication required; reopen the URL printed by dsh web.\n')
  }
}
