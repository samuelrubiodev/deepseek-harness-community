/** Behavior of the /api browser-trust fence (rebinding + cross-site defense). */

import { describe, expect, it, vi } from 'vitest'
import { assertTrustedAuthority, evaluateApiRequestTrust, isTrustedApiRequest } from '../src/api-request-trust.ts'

function request(headers: Record<string, string | undefined>): { headers: Record<string, string | undefined> } {
  return { headers }
}

describe('isTrustedApiRequest', () => {
  it('holds markerless requests to the same Host fence — a plain-HTTP browser read carries no markers', () => {
    // Over plain HTTP a browser attaches neither Origin nor Fetch-Metadata to
    // reads (EventSource, images, navigations), so a rebound-origin GET is
    // markerless and its response readable: no marker shortcut may exist.
    expect(isTrustedApiRequest(request({ host: '127.0.0.1:3080' }), [])).toBe(true)
    expect(isTrustedApiRequest(request({ host: '192.168.1.5:3080' }), ['192.168.1.5'])).toBe(true)
    expect(isTrustedApiRequest(request({ host: '192.168.1.5:3080' }), [])).toBe(false)
    expect(isTrustedApiRequest(request({ host: 'harness.example' }), [])).toBe(false)
    expect(isTrustedApiRequest(request({}), [])).toBe(false)
  })

  it('accepts loopback Hosts in every spelling, with and without ports, for browser requests', () => {
    for (const host of ['localhost', 'localhost:3080', '127.0.0.1', '127.0.0.1:3080', '127.8.9.10:80', '[::1]', '[::1]:3080', 'LOCALHOST:3080']) {
      expect(isTrustedApiRequest(request({ host, origin: `http://${host}` }), [])).toBe(true)
    }
  })

  it('refuses a rebound Host: the attacker domain names the socket it did not expect', () => {
    expect(isTrustedApiRequest(request({
      host: 'evil.example:3080',
      origin: 'http://evil.example:3080',
      'sec-fetch-site': 'same-origin',
    }), [])).toBe(false)
  })

  it('accepts a declared public authority: exact on host:port entries, any port on port-less entries', () => {
    const headers = { host: 'harness.internal:3080', origin: 'http://harness.internal:3080' }
    expect(isTrustedApiRequest(request(headers), ['harness.internal:3080'])).toBe(true)
    expect(isTrustedApiRequest(request(headers), ['harness.internal'])).toBe(true)
    expect(isTrustedApiRequest(request(headers), ['harness.internal:9999'])).toBe(false)
    expect(isTrustedApiRequest(request(headers), [])).toBe(false)
  })

  it('matches Host, Origin, and trusted entries through WHATWG normalization (case, default port)', () => {
    expect(isTrustedApiRequest(request({ host: 'Harness.INTERNAL:3080', origin: 'http://harness.internal:3080' }), ['harness.internal:3080'])).toBe(true)
    expect(isTrustedApiRequest(request({ host: 'harness.internal', origin: 'http://harness.internal' }), ['HARNESS.internal:80'])).toBe(true)
    // An unparsable entry never matches; it must not poison the rest of the list.
    expect(isTrustedApiRequest(request({ host: 'harness.internal', origin: 'http://harness.internal' }), ['bad entry', 'harness.internal'])).toBe(true)
    expect(isTrustedApiRequest(request({ host: 'harness.internal', origin: 'http://harness.internal' }), ['bad entry'])).toBe(false)
  })

  it('refuses cross-origin browser markers even on a loopback Host', () => {
    // Origin present and different → cross-site request that survived preflight rules.
    expect(isTrustedApiRequest(request({ host: '127.0.0.1:3080', origin: 'http://evil.example' }), [])).toBe(false)
    // Explicit cross-site label → refused regardless of Origin.
    expect(isTrustedApiRequest(request({ host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' }), [])).toBe(false)
    // Opaque origin (sandboxed iframe, file: page) parses to no authority.
    expect(isTrustedApiRequest(request({ host: '127.0.0.1:3080', origin: 'null' }), [])).toBe(false)
  })

  it('accepts a same-origin browser request, with or without an Origin header', () => {
    expect(isTrustedApiRequest(request({
      host: 'localhost:3080',
      origin: 'http://localhost:3080',
      'sec-fetch-site': 'same-origin',
    }), [])).toBe(true)
    // Origin-less browser shapes (same-origin GETs) still carry sec-fetch-site.
    expect(isTrustedApiRequest(request({ host: 'localhost:3080', 'sec-fetch-site': 'same-origin' }), [])).toBe(true)
  })

  it('reads Fetch Headers while preserving absent browser markers', () => {
    expect(isTrustedApiRequest({ headers: new Headers({ host: '127.0.0.1:3080' }) }, [])).toBe(true)
    expect(isTrustedApiRequest({
      headers: new Headers({ host: '127.0.0.1:3080', origin: 'http://evil.example' }),
    }, [])).toBe(false)
  })

  it('assertTrustedAuthority accepts bare authorities and throws on anything more', () => {
    for (const entry of ['harness.internal', 'harness.internal:3080', 'HARNESS.internal:80', '10.0.0.9', '[::1]:3080']) {
      expect(() => { assertTrustedAuthority(entry) }).not.toThrow()
    }
    // WHATWG parsing would quietly read a hostname out of each of these; the
    // config boundary must refuse them instead of authorizing the prefix.
    for (const entry of ['harness.internal/path', 'harness.internal/', 'user@harness.internal', 'harness.internal?x', 'harness.internal#f', 'harness.internal\\path', 'bad entry', '']) {
      expect(() => { assertTrustedAuthority(entry) }).toThrow(/not a bare host\[:port\] authority/)
    }
    // WHATWG trimming would silently strip these; the entry must fail instead.
    for (const entry of ['harness.internal:3080 ', ' harness.internal', 'harness.internal:30\t80']) {
      expect(() => { assertTrustedAuthority(entry) }).toThrow(/not a bare host\[:port\] authority/)
    }
    // WHATWG parsing would silently rewrite these — a dangling colon or
    // zero-padded port would broaden an intended exact-port grant to every
    // port, and non-canonical host spellings would not read back as written.
    for (const entry of ['harness.internal:', '[::1]:', 'harness.internal:0080', '0x7f.0.0.1', '[0:0:0:0:0:0:0:1]']) {
      expect(() => { assertTrustedAuthority(entry) }).toThrow(/not a bare host\[:port\] authority/)
    }
  })

  it('never lets stray whitespace broaden an exact-port entry to every port', () => {
    // Defense in depth below the load-time assert: the explicit-port judgment
    // reads the parsed URL, so a trimmed `host:port ` entry stays exact.
    const trusted = ['harness.internal:3080 ']
    expect(isTrustedApiRequest(request({ host: 'harness.internal:9999', origin: 'http://harness.internal:9999' }), trusted)).toBe(false)
    expect(isTrustedApiRequest(request({ host: 'harness.internal:3080', origin: 'http://harness.internal:3080' }), trusted)).toBe(true)
  })

  it('refuses malformed or untrusted authorities on browser requests', () => {
    const markers = { 'sec-fetch-site': 'same-origin' }
    expect(isTrustedApiRequest(request({ ...markers }), [])).toBe(false)
    expect(isTrustedApiRequest(request({ ...markers, host: '' }), [])).toBe(false)
    expect(isTrustedApiRequest(request({ ...markers, host: 'bad host' }), [])).toBe(false)
    expect(isTrustedApiRequest(request({ ...markers, host: '127.0.0.999' }), [])).toBe(false)
    expect(isTrustedApiRequest(request({ ...markers, host: '128.0.0.1' }), [])).toBe(false)
  })

  it('evaluates reverse proxy headers only when reverseProxy option is enabled', () => {
    const headers = {
      host: '127.0.0.1:3080',
      'x-forwarded-host': 'harness.lan:3080',
      'x-forwarded-proto': 'http',
      origin: 'http://harness.lan:3080',
    }
    // Disabled by default: origin doesn't match host (127.0.0.1:3080)
    expect(isTrustedApiRequest(request(headers), ['harness.lan'])).toBe(false)
    // Enabled explicitly: origin matches forwarded host and forwarded host is trusted
    expect(isTrustedApiRequest(request(headers), ['harness.lan'], { reverseProxy: true })).toBe(true)
    // Enabled with TLS termination
    const tlsHeaders = {
      host: '127.0.0.1:3080',
      'x-forwarded-host': 'harness.lan',
      'x-forwarded-proto': 'https',
      origin: 'https://harness.lan',
    }
    expect(isTrustedApiRequest(request(tlsHeaders), ['harness.lan'], { reverseProxy: true })).toBe(true)
    // Refuses when forwarded host is untrusted
    expect(isTrustedApiRequest(request(tlsHeaders), ['other.lan'], { reverseProxy: true })).toBe(false)
  })

  it('provides structured diagnostic failure reasons in evaluateApiRequestTrust and logs warnings', () => {
    // Missing Host header
    const missingHost = evaluateApiRequestTrust(request({}), [])
    expect(missingHost).toEqual({ trusted: false, reason: 'missing Host header' })

    // Unparseable Host
    const unparseableHost = evaluateApiRequestTrust(request({ host: 'bad host' }), [])
    expect(unparseableHost.trusted).toBe(false)
    expect((unparseableHost as { reason: string }).reason).toMatch(/unparseable Host header/)

    // Untrusted Host with empty trustedHosts
    const untrustedEmpty = evaluateApiRequestTrust(request({ host: '192.168.1.50:3080' }), [])
    expect(untrustedEmpty).toEqual({
      trusted: false,
      reason: 'untrusted host "192.168.1.50:3080" (no trustedHosts configured)',
    })

    // Untrusted Host with declared trustedHosts
    const untrustedDeclared = evaluateApiRequestTrust(request({ host: 'evil.example:3080' }), ['harness.lan'])
    expect(untrustedDeclared).toEqual({
      trusted: false,
      reason: 'untrusted host "evil.example:3080" (trustedHosts: [harness.lan])',
    })

    // Sec-Fetch-Site cross-site
    const crossSite = evaluateApiRequestTrust(request({
      host: '127.0.0.1:3080',
      'sec-fetch-site': 'cross-site',
    }), [])
    expect(crossSite).toEqual({
      trusted: false,
      reason: 'Sec-Fetch-Site is "cross-site"',
    })

    // Unparseable Origin
    const unparseableOrigin = evaluateApiRequestTrust(request({
      host: '127.0.0.1:3080',
      origin: '://broken',
    }), [])
    expect(unparseableOrigin.trusted).toBe(false)
    expect((unparseableOrigin as { reason: string }).reason).toMatch(/unparseable Origin header/)

    // Origin mismatch
    const originMismatch = evaluateApiRequestTrust(request({
      host: '127.0.0.1:3080',
      origin: 'http://evil.com',
    }), [])
    expect(originMismatch).toEqual({
      trusted: false,
      reason: 'origin mismatch ("evil.com" vs "127.0.0.1:3080")',
    })

    // onReject callback receives exact reason
    const rejections: string[] = []
    const rejected = isTrustedApiRequest(request({ host: 'untrusted.lan' }), [], {
      onReject: reason => rejections.push(reason),
    })
    expect(rejected).toBe(false)
    expect(rejections).toEqual(['untrusted host "untrusted.lan" (no trustedHosts configured)'])

    // logger option logs warning
    const warnSpy = vi.fn()
    isTrustedApiRequest(request({ host: 'untrusted.lan' }), [], {
      logger: { warn: warnSpy },
    })
    expect(warnSpy).toHaveBeenCalledWith(
      'client-connection: API request rejected (403): untrusted host "untrusted.lan" (no trustedHosts configured)',
    )
  })
})
