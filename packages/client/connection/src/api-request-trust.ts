/**
 * Browser-trust fence for every /api request. Defends the two confused-deputy
 * paths a browser opens against a local HTTP API — DNS rebinding (Host names
 * the attacker's domain while the socket reaches this server) and cross-site
 * requests fired from a malicious page. The Host fence binds every request,
 * browser-looking or not: over plain HTTP a browser attaches neither Origin
 * nor Fetch-Metadata to reads (images and navigations — those
 * headers go only to trustworthy destinations), so an unmarked request may
 * still be a rebound browser read and Host is the one header rebinding cannot
 * forge. Non-browser and remote clients pass the same fence via loopback,
 * deployment-derived LAN IP literals, or a declared `trustedHosts` authority.
 * Network reachability and authentication stay out of scope: binding policy
 * belongs to the webserver config, and this fence is not an auth layer.
 */

import { isLoopbackHostname } from './loopback-hostname.ts'
import type { ConnectionTrustRequest } from './rpc.ts'

/**
 * Read a header from a Headers instance or a plain object dictionary.
 *
 * @param headers - Container with request headers.
 * @param name - Header name to look up.
 * @returns Header value or undefined if not present.
 */
export function header(headers: ConnectionTrustRequest['headers'], name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

/**
 * Extract the first comma-separated segment of a header value.
 *
 * @param value - Raw header string or undefined.
 * @returns Trimmed first segment or undefined when empty.
 */
export function firstHeaderSegment(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const at = value.indexOf(',')
  const segment = at === -1 ? value : value.slice(0, at)
  const trimmed = segment.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** Normalized URL of a Host-header authority (hostname lowercased, default port stripped, IPv6 bracketed), or undefined when unparsable. */
function parseAuthority(authority: string): URL | undefined {
  try {
    // http: is a WHATWG "special scheme": parsing yields a non-empty hostname or throws.
    return new URL(`http://${authority}`)
  } catch {
    return undefined
  }
}

/**
 * Assert one configured `trustedHosts` entry is a bare authority (`host` or
 * `host:port`) in canonical form: it must survive WHATWG parsing unchanged
 * (case aside). Anything parsing would silently rewrite is refused as a typo
 * that must fail the load loudly instead of being ignored until requests 403
 * or quietly changing the grant: URL parts beyond the authority
 * (`harness.internal/path`, `user@harness.internal` — which would authorize
 * the embedded hostname), stripped whitespace, a dangling colon or
 * zero-padded port (which would broaden an intended exact-port grant to every
 * port), and non-canonical host spellings (`0x7f.0.0.1`, percent-encoding,
 * unbracketed IPv6; IDN hosts are declared in punycode, the form the wire
 * carries).
 * @param entry - the configured value, verbatim.
 */
export function assertTrustedAuthority(entry: string): void {
  const entryUrl = parseAuthority(entry)
  if (entryUrl !== undefined && canonicalAuthority(entry, entryUrl) === entry.toLowerCase()) return
  throw new Error(`client-connection: trustedHosts entry ${JSON.stringify(entry)} is not a bare host[:port] authority`)
}

/**
 * Canonical form of a parsed authority: `hostname` when no port was written,
 * else `hostname:port`. The port is judged from URL parses under both special
 * schemes (their default ports differ, so `:80` and `:443` still count as
 * explicit), never from the raw string, where WHATWG trimming would misread
 * shapes like `host:port ` as port-less.
 */
function canonicalAuthority(entry: string, entryUrl: URL): string {
  // An authority that parsed under http cannot fail under https.
  const port = entryUrl.port !== '' ? entryUrl.port : new URL(`https://${entry}`).port
  return port === '' ? entryUrl.hostname : `${entryUrl.hostname}:${port}`
}

/**
 * Whether the request authority matches a `trustedHosts` entry. An entry with
 * an explicit port matches that exact authority; a port-less entry matches the
 * hostname on any port (the shape the CLI derives for IP-literal LAN serving,
 * where the bound port may be OS-assigned). Both sides compare through WHATWG
 * normalization, so case and a redundant `:80` never decide trust.
 */
function isTrustedAuthority(hostUrl: URL, trustedHosts: readonly string[]): boolean {
  return trustedHosts.some((entry) => {
    const entryUrl = parseAuthority(entry)
    if (entryUrl === undefined) return false
    return canonicalAuthority(entry, entryUrl) === entryUrl.hostname
      ? entryUrl.hostname === hostUrl.hostname
      : entryUrl.host === hostUrl.host
  })
}

/** Result of evaluating API request trust. */
export type ApiRequestTrustResult =
  | { readonly trusted: true }
  | { readonly trusted: false; readonly reason: string }

/** Options controlling reverse-proxy evaluation and diagnostics for /api requests. */
export interface TrustedApiRequestOptions {
  /** When true, trust standard X-Forwarded-Host and X-Forwarded-Proto reverse proxy headers. */
  readonly reverseProxy?: boolean
  /** Optional callback invoked with the diagnostic reason when a request is rejected. */
  readonly onReject?: (reason: string) => void
  /** Optional logger to output warning on rejection. */
  readonly logger?: { warn: (message: string, ...args: unknown[]) => void }
}

/**
 * Evaluate whether one /api request may reach the RPC bridge with detailed diagnostic result.
 * @param request - Node HTTP or Fetch request facts (headers).
 * @param trustedHosts - non-loopback authorities this deployment serves: exact `host:port`, or port-less `host` matching any port.
 * @param options - optional request trust options (e.g. reverseProxy support).
 * @returns detailed trust result with rejection reason if untrusted.
 */
export function evaluateApiRequestTrust(
  request: ConnectionTrustRequest,
  trustedHosts: readonly string[],
  options?: TrustedApiRequestOptions,
): ApiRequestTrustResult {
  const reverseProxy = options?.reverseProxy ?? (process.env.DSH_REVERSE_PROXY === 'true' || process.env.DSH_REVERSE_PROXY === '1')
  const rawHost = header(request.headers, 'host')
  if (rawHost === undefined) {
    return { trusted: false, reason: 'missing Host header' }
  }

  const forwardedHost = reverseProxy ? firstHeaderSegment(header(request.headers, 'x-forwarded-host')) : undefined
  const host = forwardedHost ?? rawHost
  const proto = (reverseProxy ? firstHeaderSegment(header(request.headers, 'x-forwarded-proto')) : undefined) ?? 'http'

  let hostUrl: URL | undefined
  try {
    hostUrl = new URL(`${proto}://${host}`)
  } catch {
    return { trusted: false, reason: `unparseable Host header "${host}"` }
  }
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) {
    const trustedSummary = trustedHosts.length > 0 ? `trustedHosts: [${trustedHosts.join(', ')}]` : 'no trustedHosts configured'
    return { trusted: false, reason: `untrusted host "${hostUrl.host}" (${trustedSummary})` }
  }

  if (header(request.headers, 'sec-fetch-site') === 'cross-site') {
    return { trusted: false, reason: 'Sec-Fetch-Site is "cross-site"' }
  }

  const origin = header(request.headers, 'origin')
  if (origin === undefined) return { trusted: true }

  let originUrl: URL | undefined
  try {
    originUrl = new URL(origin)
  } catch {
    return { trusted: false, reason: `unparseable Origin header "${origin}"` }
  }

  if (originUrl.host !== hostUrl.host) {
    return { trusted: false, reason: `origin mismatch ("${originUrl.host}" vs "${hostUrl.host}")` }
  }

  return { trusted: true }
}

/**
 * Decide whether one /api request may reach the RPC bridge.
 * @param request - Node HTTP or Fetch request facts (headers).
 * @param trustedHosts - non-loopback authorities this deployment serves: exact `host:port`, or port-less `host` matching any port.
 * @param options - optional request trust options (e.g. reverseProxy support).
 * @returns true when the Host is ours (loopback or trusted) and any attached browser markers are same-origin.
 */
export function isTrustedApiRequest(
  request: ConnectionTrustRequest,
  trustedHosts: readonly string[],
  options?: TrustedApiRequestOptions,
): boolean {
  const result = evaluateApiRequestTrust(request, trustedHosts, options)
  if (!result.trusted) {
    options?.onReject?.(result.reason)
    options?.logger?.warn(`client-connection: API request rejected (403): ${result.reason}`)
    return false
  }
  return true
}
