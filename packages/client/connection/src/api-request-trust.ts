/**
 * Browser-trust fence for every /api request. Defends the two confused-deputy
 * paths a browser opens against a local HTTP API — DNS rebinding (Host names
 * the attacker's domain while the socket reaches this server) and cross-site
 * requests fired from a malicious page. The Host fence binds every request,
 * browser-looking or not: over plain HTTP a browser attaches neither Origin
 * nor Fetch-Metadata to reads (images and navigations — those headers go only
 * to trustworthy destinations), so an unmarked request may still be a rebound
 * browser read and Host is the one header rebinding cannot forge. Non-browser
 * and remote clients pass the same fence via loopback, the listener's bind IP
 * literal, or a declared `trustedHosts` authority. Binding policy belongs to
 * the webserver config; this fence never establishes identity.
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

/**
 * Normalized URL of a bare authority (hostname lowercased, default port
 * stripped, IPv6 bracketed), or undefined when unparsable.
 * @param authority - `host` or `host:port` text.
 * @param scheme - special scheme to parse under; its default port is the one stripped.
 */
function parseAuthority(authority: string, scheme: 'http:' | 'https:' = 'http:'): URL | undefined {
  try {
    // http: and https: are WHATWG "special schemes": parsing yields a non-empty hostname or throws.
    return new URL(`${scheme}//${authority}`)
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
  const port = entryUrl.port !== '' ? entryUrl.port : new URL(`${entryUrl.protocol === 'http:' ? 'https:' : 'http:'}//${entry}`).port
  return port === '' ? entryUrl.hostname : `${entryUrl.hostname}:${port}`
}

/**
 * Whether the request authority matches a `trustedHosts` entry. An entry with
 * an explicit port matches that exact authority; a port-less entry matches the
 * hostname on any port. Both sides compare through WHATWG normalization,
 * so case and a redundant scheme-default port never decide trust.
 */
function isTrustedAuthority(hostUrl: URL, trustedHosts: readonly string[], protocol: 'http:' | 'https:'): boolean {
  return trustedHosts.some((entry) => {
    const entryUrl = parseAuthority(entry, protocol)
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
  /** The listener's own bind IP literal, accepted on any port independently of `trustedHosts`. */
  readonly bindHost?: string | undefined
  /** Listener protocol for default Host ports; HTTP when no Web carrier is mounted. */
  readonly protocol?: 'http:' | 'https:' | undefined
  /** When true, trust standard X-Forwarded-Host and X-Forwarded-Proto reverse proxy headers. */
  readonly reverseProxy?: boolean | undefined
  /** Optional callback invoked with the diagnostic reason when a request is rejected. */
  readonly onReject?: ((reason: string) => void) | undefined
  /** Optional logger to output warning on rejection. */
  readonly logger?: { warn: (message: string, ...args: unknown[]) => void } | undefined
}

/**
 * Compare Host under the Origin's HTTP(S) scheme so default ports normalize
 * consistently. The transport may remain HTTP behind an HTTPS proxy.
 * @param origin - verbatim Origin header value.
 * @param host - verbatim Host header value already accepted by the Host fence.
 * @returns true only when the Origin is this listener's own `http(s)` authority.
 */
function isSameAuthorityOrigin(origin: string, host: string): boolean {
  let originUrl: URL
  try {
    originUrl = new URL(origin)
  } catch {
    return false
  }
  // Only http(s) can name this listener: the opaque `null` already threw above,
  // and every other scheme (file:, ftp:) fails here rather than matching by
  // hostname alone.
  const scheme = originUrl.protocol === 'https:' ? 'https:'
    : originUrl.protocol === 'http:' ? 'http:'
      : undefined
  if (scheme === undefined) return false
  const hostUrl = parseAuthority(host, scheme)
  return hostUrl !== undefined && originUrl.host === hostUrl.host
}

/**
 * Classify an authority already accepted by {@link assertTrustedAuthority}.
 * @param entry - the configured authority, verbatim.
 * @returns true unless the entry parses as a loopback hostname.
 */
export function isRemoteAuthority(entry: string): boolean {
  const url = parseAuthority(entry)
  return url === undefined || !isLoopbackHostname(url.hostname)
}

/**
 * Whether a parsed authority names the deployment's own bind address. A browser
 * dialing that literal sends it as Host, and accepting it grants nothing
 * further: the literal is no rebinding target, the Origin and cross-site checks
 * still apply, and it stays outside `trustedHosts`. Matching ignores the port,
 * like a port-less entry, and any `%zone` id (an interface selector, not
 * address text).
 */
function isBindAddressAuthority(hostUrl: URL, bindHost: string | undefined): boolean {
  if (bindHost === undefined) return false
  const zoneAt = bindHost.indexOf('%')
  const address = zoneAt === -1 ? bindHost : bindHost.slice(0, zoneAt)
  const bindUrl = parseAuthority(address.includes(':') ? `[${address}]` : address)
  return bindUrl !== undefined && bindUrl.hostname === hostUrl.hostname
}

/**
 * Evaluate whether one /api request may reach the RPC bridge with detailed diagnostic result.
 * @param request - Node HTTP or Fetch request facts (headers).
 * @param trustedHosts - non-loopback authorities this deployment serves: exact `host:port`, or port-less `host` matching any port.
 * @param options - optional request trust options (e.g. reverseProxy support) or bindHost literal.
 * @param protocol - default listener protocol when options is a bindHost literal.
 * @returns detailed trust result with rejection reason if untrusted.
 */
export function evaluateApiRequestTrust(
  request: ConnectionTrustRequest,
  trustedHosts: readonly string[],
  options?: TrustedApiRequestOptions | string,
  protocol: 'http:' | 'https:' = 'http:',
): ApiRequestTrustResult {
  const opts: TrustedApiRequestOptions = typeof options === 'string'
    ? { bindHost: options, protocol }
    : (options ?? {})
  const reverseProxy = opts.reverseProxy ?? (process.env.DSH_REVERSE_PROXY === 'true' || process.env.DSH_REVERSE_PROXY === '1')
  const defaultProto = opts.protocol ?? protocol
  const rawHost = header(request.headers, 'host')
  if (rawHost === undefined) {
    return { trusted: false, reason: 'missing Host header' }
  }

  const forwardedHost = reverseProxy ? firstHeaderSegment(header(request.headers, 'x-forwarded-host')) : undefined
  const host = forwardedHost ?? rawHost
  const proto = (reverseProxy ? firstHeaderSegment(header(request.headers, 'x-forwarded-proto')) : undefined) ?? defaultProto
  const scheme = proto === 'https' || proto === 'https:' ? 'https:' : 'http:'

  const hostUrl = parseAuthority(host, scheme)
  if (hostUrl === undefined) {
    return { trusted: false, reason: `unparseable Host header "${host}"` }
  }
  if (!isLoopbackHostname(hostUrl.hostname)
    && !isTrustedAuthority(hostUrl, trustedHosts, scheme)
    && !isBindAddressAuthority(hostUrl, opts.bindHost)) {
    const trustedSummary = trustedHosts.length > 0 ? `trustedHosts: [${trustedHosts.join(', ')}]` : 'no trustedHosts configured'
    return { trusted: false, reason: `untrusted host "${hostUrl.host}" (${trustedSummary})` }
  }

  if (header(request.headers, 'sec-fetch-site') === 'cross-site') {
    return { trusted: false, reason: 'Sec-Fetch-Site is "cross-site"' }
  }

  const origin = header(request.headers, 'origin')
  if (origin === undefined) return { trusted: true }

  if (!isSameAuthorityOrigin(origin, host)) {
    let originHost = origin
    try {
      originHost = new URL(origin).host
    } catch {
      return { trusted: false, reason: `unparseable Origin header "${origin}"` }
    }
    return { trusted: false, reason: `origin mismatch ("${originHost}" vs "${hostUrl.host}")` }
  }

  return { trusted: true }
}

/**
 * Decide whether one /api request may reach the RPC bridge.
 * @param request - Node HTTP or Fetch request facts (headers).
 * @param trustedHosts - non-loopback authorities this deployment serves: exact `host:port`, or port-less `host` matching any port.
 * @param bindHostOrOptions - the listener's own bind IP literal, accepted on any port
 * independently of `trustedHosts`, or an options object.
 * @param protocol - listener protocol for default Host ports; HTTP when no Web carrier is mounted.
 * @param maybeOptions - optional options when bindHost was provided as string.
 * @returns true when the Host is ours (loopback, the bind address, or trusted) and any attached browser markers are same-origin.
 */
export function isTrustedApiRequest(
  request: ConnectionTrustRequest,
  trustedHosts: readonly string[],
  bindHostOrOptions?: string | TrustedApiRequestOptions,
  protocol: 'http:' | 'https:' = 'http:',
  maybeOptions?: TrustedApiRequestOptions,
): boolean {
  const opts: TrustedApiRequestOptions = typeof bindHostOrOptions === 'string'
    ? { bindHost: bindHostOrOptions, protocol, ...maybeOptions }
    : (bindHostOrOptions ?? {})
  const result = evaluateApiRequestTrust(request, trustedHosts, opts)
  if (!result.trusted) {
    opts.onReject?.(result.reason)
    opts.logger?.warn(`client-connection: API request rejected (403): ${result.reason}`)
    return false
  }
  return true
}
