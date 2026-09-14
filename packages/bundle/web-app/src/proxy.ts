/**
 * @deepseek-ai/dsh-web-app — dynamic port proxy for development web servers.
 *
 * Exposes internal dev servers (Node, Vite, Python, etc.) running on arbitrary
 * ports inside the container or host through the existing Web GUI port:
 *   /proxy/<port>/... -> http://127.0.0.1:<port>/...
 *
 * Bounded to valid TCP ports (1-65535), gated by the composition's connection
 * trust fence, and rewrites relative Location headers so redirects remain
 * within the proxy path.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import http from 'node:http'
import type { Duplex } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'

/** Trust surface consumed here; the browser-side connection package owns the full type. */
export interface ProxyConnection {
  requestRejection(request: { readonly headers: IncomingMessage['headers'] }): 401 | 403 | undefined
}

function connectionOf(ctx: Context): ProxyConnection | undefined {
  try {
    return (ctx as unknown as { connection?: ProxyConnection }).connection
  } catch {
    return undefined
  }
}

/** Route prefix under which dynamic port proxy endpoints are mounted. */
export const PROXY_ROUTE_PREFIX = '/proxy'

/** Hop-by-hop headers that must not be forwarded by HTTP proxies per RFC 7230 §6.1. */
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'trailers',
  'transfer-encoding',
  'upgrade',
])

function rewriteLocation(location: string, port: number): string {
  const loopbackPrefix = `http://127.0.0.1:${String(port)}`
  const localhostPrefix = `http://localhost:${String(port)}`
  if (location.startsWith(loopbackPrefix)) {
    return `${PROXY_ROUTE_PREFIX}/${String(port)}${location.slice(loopbackPrefix.length)}`
  }
  if (location.startsWith(localhostPrefix)) {
    return `${PROXY_ROUTE_PREFIX}/${String(port)}${location.slice(localhostPrefix.length)}`
  }
  if (location.startsWith('/') && !location.startsWith(`${PROXY_ROUTE_PREFIX}/${String(port)}`)) {
    return `${PROXY_ROUTE_PREFIX}/${String(port)}${location}`
  }
  return location
}function onceCompleter(done: () => void): () => void {
  let finished = false
  return (): void => {
    if (!finished) {
      finished = true
      done()
    }
  }
}


/**
 * Rewrite HTML content from proxied dev servers so that root-relative asset URLs,
 * base tags, and client fetch/XHR requests remain scoped under the proxy path.
 *
 * @param html - Original HTML markup from the target server.
 * @param port - Internal dev server port.
 * @returns Rewritten HTML markup with base tag and client proxy shim.
 */
export function rewriteHtml(html: string, port: number): string {
  const proxyBase = `${PROXY_ROUTE_PREFIX}/${String(port)}/`

  const clientShim = `<script>
(() => {
  const base = '${PROXY_ROUTE_PREFIX}/${String(port)}';
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function(input, init) {
      if (typeof input === 'string' && input.startsWith('/') && !input.startsWith('/proxy/')) {
        input = base + input;
      } else if (typeof Request !== 'undefined' && input instanceof Request && input.url.startsWith('/') && !input.url.startsWith('/proxy/')) {
        input = new Request(base + input.url, input);
      }
      return origFetch.call(this, input, init);
    };
  }
  if (typeof XMLHttpRequest !== 'undefined') {
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...args) {
      if (typeof url === 'string' && url.startsWith('/') && !url.startsWith('/proxy/')) {
        url = base + url;
      }
      return origOpen.call(this, method, url, ...args);
    };
  }
  if (typeof WebSocket !== 'undefined') {
    const OrigWebSocket = window.WebSocket;
    class ProxiedWebSocket extends OrigWebSocket {
      constructor(url, protocols) {
        let targetUrl = url;
        try {
          const parsed = new URL(targetUrl, window.location.href);
          const isSameHost = parsed.host === window.location.host;
          const isLoopbackTarget = (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
            && (parsed.port === '${String(port)}' || parsed.port === '');
          if (isSameHost && !parsed.pathname.startsWith(base)) {
            parsed.pathname = base + (parsed.pathname.startsWith('/') ? parsed.pathname : '/' + parsed.pathname);
            targetUrl = parsed.toString();
          } else if (isLoopbackTarget) {
            parsed.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            parsed.host = window.location.host;
            if (!parsed.pathname.startsWith(base)) {
              parsed.pathname = base + (parsed.pathname.startsWith('/') ? parsed.pathname : '/' + parsed.pathname);
            }
            targetUrl = parsed.toString();
          }
        } catch {}
        if (protocols !== undefined) {
          super(targetUrl, protocols);
        } else {
          super(targetUrl);
        }
      }
    }
    window.WebSocket = ProxiedWebSocket;
  }
  if (typeof EventSource !== 'undefined') {
    const OrigEventSource = window.EventSource;
    class ProxiedEventSource extends OrigEventSource {
      constructor(url, eventSourceInitDict) {
        let targetUrl = url;
        try {
          if (typeof targetUrl === 'string' && targetUrl.startsWith('/') && !targetUrl.startsWith('/proxy/')) {
            targetUrl = base + targetUrl;
          } else {
            const parsed = new URL(targetUrl, window.location.href);
            if (parsed.host === window.location.host && !parsed.pathname.startsWith(base)) {
              parsed.pathname = base + (parsed.pathname.startsWith('/') ? parsed.pathname : '/' + parsed.pathname);
              targetUrl = parsed.toString();
            }
          }
        } catch {}
        if (eventSourceInitDict !== undefined) {
          super(targetUrl, eventSourceInitDict);
        } else {
          super(targetUrl);
        }
      }
    }
    window.EventSource = ProxiedEventSource;
  }
})();
</script>`

  let rewritten = html

  // 1. Inject or update <base href="/proxy/<port>/"> and client shim
  if (/<base\s[^>]*href=/iu.test(rewritten)) {
    rewritten = rewritten.replace(/<base\s+([^>]*?)href=(["'])(.*?)\2([^>]*)>/giu, `<base $1href=$2${proxyBase}$2$4>\n  ${clientShim}`)
  } else if (/<head(?:\s[^>]*)?>/iu.test(rewritten)) {
    rewritten = rewritten.replace(/<head(?:\s[^>]*)?>/iu, open => `${open}\n  <base href="${proxyBase}">\n  ${clientShim}`)
  } else {
    rewritten = `<base href="${proxyBase}">\n${clientShim}\n${rewritten}`
  }

  // 2. Rewrite root-relative URLs in tag attributes (href, src, action, poster)
  rewritten = rewritten.replace(
    /\b(href|src|action|poster)=(["'])\/(?!\/|proxy\/\d+)(.*?)\2/giu,
    (_match, attr, quote, path) => `${attr}=${quote}${proxyBase}${path}${quote}`,
  )

  // 3. Rewrite root-relative module import statements
  rewritten = rewritten.replace(
    /\bfrom\s+(["'])\/(?!\/|proxy\/\d+)(.*?)\1/gu,
    (_match, quote, path) => `from ${quote}${proxyBase}${path}${quote}`,
  )

  return rewritten
}

/**
 * Handle incoming dynamic proxy requests on `/proxy/:port/*`.
 *
 * @param req - The incoming HTTP request.
 * @param res - The server HTTP response.
 * @param ctx - The Cordis context carrying webServer and connection services.
 * @param explicitConnection - Optional resolved ProxyConnection instance from inject.
 * @returns A promise resolving when the proxy request cycle completes.
 */
export async function handleProxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: Context,
  explicitConnection?: ProxyConnection,
): Promise<void> {
  try {
    // 1. Connection security / authentication fence
    const conn = explicitConnection ?? connectionOf(ctx)
    if (conn !== undefined) {
      try {
        const rejection = conn.requestRejection(req)
        if (rejection !== undefined) {
          res.statusCode = rejection
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({
            error: rejection === 401 ? 'unauthorized' : 'forbidden',
            message: rejection === 401
              ? 'Authentication required. Please authenticate in the DeepSeek Harness Web UI first.'
              : 'Access forbidden by trust fence.',
          }))
          return
        }
      } catch {
        res.statusCode = 403
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: 'forbidden', message: 'Trust evaluation failed' }))
        return
      }
    }

    // 2. Parse URL and extract port
    let fullUrl: URL
    try {
      fullUrl = new URL(req.url ?? '/', 'http://127.0.0.1')
    } catch {
      res.statusCode = 400
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: 'invalid-url', message: 'Unparseable request URL' }))
      return
    }

    const pathname = fullUrl.pathname
    const search = fullUrl.search

    // Expected path format: /proxy/<port> or /proxy/<port>/...
    const match = /^\/proxy\/(\d+)(\/.*)?$/u.exec(pathname)
    if (!match) {
      res.statusCode = 400
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({
        error: 'invalid-proxy-path',
        message: 'Proxy path must be in format /proxy/<port>/...',
      }))
      return
    }

    const portStr = String(match[1])
    const port = parseInt(portStr, 10)
    const rest = match[2]

    // Port validity checks
    if (Number.isNaN(port) || port < 1 || port > 65535) {
      res.statusCode = 400
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: 'invalid-port', message: `Invalid port: ${portStr}` }))
      return
    }

    // Prevent proxy loop to webServer itself
    const webServerPort = (ctx as unknown as { webServer?: { port?: number } }).webServer?.port
    if (webServerPort !== undefined && port === webServerPort) {
      res.statusCode = 400
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: 'proxy-loop', message: 'Cannot proxy to the harness webserver port' }))
      return
    }

    // 3. Trailing slash normalization: if /proxy/8210 (without trailing slash), redirect to /proxy/8210/
    if (rest === undefined) {
      res.statusCode = 307
      res.setHeader('location', `${PROXY_ROUTE_PREFIX}/${String(port)}/${search}`)
      res.end()
      return
    }

    // 4. Forward to 127.0.0.1:port
    const targetPath = rest + search
    const forwardHeaders: http.OutgoingHttpHeaders = {}
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue
      const lower = key.toLowerCase()
      if (HOP_BY_HOP_HEADERS.has(lower)) continue
      forwardHeaders[key] = value
    }
    forwardHeaders.host = `127.0.0.1:${String(port)}`
    forwardHeaders['x-forwarded-host'] = req.headers.host ?? `127.0.0.1:${String(webServerPort ?? 3080)}`
    forwardHeaders['x-forwarded-proto'] = 'http'
    forwardHeaders['accept-encoding'] = 'identity'
    if (req.socket.remoteAddress) {
      forwardHeaders['x-forwarded-for'] = req.socket.remoteAddress
    }

    await new Promise<void>((resolve) => {
      const finish = onceCompleter(resolve)

      const targetReq = http.request({
        hostname: '127.0.0.1',
        port,
        path: targetPath,
        method: req.method,
        headers: forwardHeaders,
      }, (targetRes) => {
        res.statusCode = targetRes.statusCode ?? 200

        // Prevent outer WebServer gzip middleware from corrupting proxied streams or content lengths
        res.setHeader('x-no-compression', '1')

        const contentType = targetRes.headers['content-type'] ?? ''
        const isHtml = typeof contentType === 'string' && contentType.toLowerCase().includes('text/html')

        // Forward response headers with location rewriting and hop-by-hop stripping
        for (const [key, value] of Object.entries(targetRes.headers)) {
          if (value === undefined) continue
          const lower = key.toLowerCase()
          if (HOP_BY_HOP_HEADERS.has(lower)) continue

          if (lower === 'location' && typeof value === 'string') {
            res.setHeader(key, rewriteLocation(value, port))
          } else if (isHtml && lower === 'content-length') {
            continue
          } else {
            try {
              res.setHeader(key, value)
            } catch {
              // Ignore invalid header names or values from dev servers
            }
          }
        }

        if (isHtml) {
          const chunks: Buffer[] = []
          targetRes.on('data', (chunk: Buffer) => {
            chunks.push(chunk)
          })
          targetRes.on('end', () => {
            const rawHtml = Buffer.concat(chunks).toString('utf8')
            const rewritten = rewriteHtml(rawHtml, port)
            const bodyBuf = Buffer.from(rewritten, 'utf8')
            res.setHeader('content-length', bodyBuf.length)
            res.end(bodyBuf)
            finish()
          })
          targetRes.on('error', () => {
            if (!res.writableEnded) res.end()
            finish()
          })
        } else {
          targetRes.pipe(res)
          targetRes.on('end', finish)
          targetRes.on('error', () => {
            if (!res.writableEnded) res.end()
            finish()
          })
        }
      })

      targetReq.on('error', (err: NodeJS.ErrnoException) => {
        if (res.headersSent) {
          res.destroy()
          finish()
          return
        }
        res.statusCode = 502
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({
          error: 'bad-gateway',
          message: `No service is reachable on internal port ${String(port)} (${err.code ?? err.message}).`,
        }))
        finish()
      })

      if (req.method === 'GET' || req.method === 'HEAD' || req.readableEnded) {
        targetReq.end()
      } else {
        req.pipe(targetReq)
        req.on('error', () => {
          targetReq.destroy()
          finish()
        })
      }
    })
  } catch (error) {
    if (!res.headersSent) {
      res.statusCode = 500
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({
        error: 'proxy-internal-error',
        message: error instanceof Error ? error.message : String(error),
      }))
    } else if (!res.writableEnded) {
      res.destroy()
    }
  }
}

/**
 * Extract proxy target port from Referer header URL if present.
 *
 * @param referer - Optional Referer header string.
 * @returns Port number if referer contains a valid /proxy/<port>/ path, undefined otherwise.
 */
export function proxyPortFromReferer(referer: string | undefined): number | undefined {
  if (referer === undefined) return undefined
  try {
    const url = new URL(referer)
    const match = /^\/proxy\/(\d+)(?:\/.*)?$/u.exec(url.pathname)
    if (match?.[1] !== undefined) {
      const port = parseInt(match[1], 10)
      if (!Number.isNaN(port) && port >= 1 && port <= 65535) {
        return port
      }
    }
  } catch {
    return undefined
  }
  return undefined
}

/**
 * Handle incoming dynamic proxy WebSocket upgrade requests on `/proxy/:port/*`.
 *
 * @param req - The incoming HTTP upgrade request.
 * @param socket - The network duplex socket of the upgrade.
 * @param head - Initial bytes read from the socket.
 * @param ctx - The Cordis context carrying webServer and connection services.
 * @param explicitConnection - Optional resolved ProxyConnection instance from inject.
 * @param overridePort - Optional port to forward to (used by fallback Referer routing).
 * @returns A promise resolving when the upgrade handling completes or sets up piping.
 */
export async function handleProxyUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  ctx: Context,
  explicitConnection?: ProxyConnection,
  overridePort?: number,
): Promise<void> {
  try {
    // 1. Connection security / authentication fence
    const conn = explicitConnection ?? connectionOf(ctx)
    if (conn !== undefined) {
      try {
        const rejection = conn.requestRejection(req)
        if (rejection !== undefined) {
          socket.write(`HTTP/1.1 ${String(rejection)} ${rejection === 401 ? 'Unauthorized' : 'Forbidden'}\r\n\r\n`)
          socket.destroy()
          return
        }
      } catch {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
        socket.destroy()
        return
      }
    }

    // 2. Parse URL and extract port
    let fullUrl: URL
    try {
      fullUrl = new URL(req.url ?? '/', 'http://127.0.0.1')
    } catch {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
      socket.destroy()
      return
    }

    const pathname = fullUrl.pathname
    const search = fullUrl.search
    let port = overridePort
    let targetPath = pathname + search

    if (port === undefined) {
      const match = /^\/proxy\/(\d+)(\/.*)?$/u.exec(pathname)
      if (match && match[1] !== undefined) {
        port = parseInt(match[1], 10)
        const rest = match[2] ?? '/'
        targetPath = rest + search
      } else {
        const referer = req.headers.referer
        if (typeof referer === 'string') {
          port = proxyPortFromReferer(referer)
        }
      }
    }

    if (port === undefined || Number.isNaN(port) || port < 1 || port > 65535) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
      socket.destroy()
      return
    }

    // Prevent proxy loop to webServer itself
    const webServerPort = (ctx as unknown as { webServer?: { port?: number } }).webServer?.port
    if (webServerPort !== undefined && port === webServerPort) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
      socket.destroy()
      return
    }

    // 3. Forward to 127.0.0.1:port
    const forwardHeaders: http.OutgoingHttpHeaders = {}
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue
      forwardHeaders[key] = value
    }
    forwardHeaders.host = `127.0.0.1:${String(port)}`
    forwardHeaders['x-forwarded-host'] = req.headers.host ?? `127.0.0.1:${String(webServerPort ?? 3080)}`
    forwardHeaders['x-forwarded-proto'] = 'http'
    if (req.headers.origin !== undefined) {
      forwardHeaders.origin = `http://127.0.0.1:${String(port)}`
    }
    if (req.socket.remoteAddress) {
      forwardHeaders['x-forwarded-for'] = req.socket.remoteAddress
    }

    await new Promise<void>((resolve) => {
      const finish = onceCompleter(resolve)

      const targetReq = http.request({
        hostname: '127.0.0.1',
        port,
        path: targetPath,
        method: req.method ?? 'GET',
        headers: forwardHeaders,
      })

      targetReq.on('upgrade', (targetRes, targetSocket, targetHead) => {
        const statusLine = `HTTP/1.1 ${String(targetRes.statusCode ?? 101)} ${targetRes.statusMessage ?? 'Switching Protocols'}\r\n`
        let headersStr = ''
        for (let i = 0; i < targetRes.rawHeaders.length; i += 2) {
          headersStr += `${targetRes.rawHeaders[i]}: ${targetRes.rawHeaders[i + 1]}\r\n`
        }
        socket.write(`${statusLine}${headersStr}\r\n`)

        if (targetHead.length > 0) {
          socket.write(targetHead)
        }
        if (head.length > 0) {
          targetSocket.write(head)
        }

        targetSocket.pipe(socket)
        socket.pipe(targetSocket)

        const cleanup = (): void => {
          targetSocket.destroy()
          socket.destroy()
        }
        targetSocket.once('error', cleanup)
        socket.once('error', cleanup)
        targetSocket.once('close', cleanup)
        socket.once('close', cleanup)
        targetSocket.once('end', cleanup)
        socket.once('end', cleanup)
        finish()
      })

      targetReq.on('response', (targetRes) => {
        if (!socket.destroyed) {
          const statusLine = `HTTP/1.1 ${String(targetRes.statusCode ?? 502)} ${targetRes.statusMessage ?? ''}\r\n`
          let headersStr = ''
          for (let i = 0; i < targetRes.rawHeaders.length; i += 2) {
            headersStr += `${targetRes.rawHeaders[i]}: ${targetRes.rawHeaders[i + 1]}\r\n`
          }
          socket.write(`${statusLine}${headersStr}\r\n`)
          targetRes.pipe(socket)
          targetRes.on('end', finish)
        } else {
          finish()
        }
      })

      targetReq.on('error', () => {
        if (!socket.destroyed) {
          socket.write('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n')
          socket.destroy()
        }
        finish()
      })

      const onClientClose = (): void => {
        targetReq.destroy()
        finish()
      }
      socket.once('close', onClientClose)
      socket.once('error', onClientClose)

      targetReq.end()
    })
  } catch {
    if (!socket.destroyed) {
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n')
      socket.destroy()
    }
  }
}

/**
 * Handle unmatched WebSocket upgrade requests by inspecting the Referer header.
 *
 * @param req - The incoming HTTP upgrade request.
 * @param socket - The network duplex socket of the upgrade.
 * @param head - Initial bytes read from the socket.
 * @param ctx - The Cordis context.
 * @param explicitConnection - Optional resolved ProxyConnection instance.
 * @returns A promise resolving when handled or socket destroyed.
 */
export async function handleProxyUpgradeFallback(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  ctx: Context,
  explicitConnection?: ProxyConnection,
): Promise<void> {
  const referer = req.headers.referer
  if (typeof referer === 'string') {
    const port = proxyPortFromReferer(referer)
    if (port !== undefined) {
      await handleProxyUpgrade(req, socket, head, ctx, explicitConnection, port)
      return
    }
  }
  socket.destroy()
}
