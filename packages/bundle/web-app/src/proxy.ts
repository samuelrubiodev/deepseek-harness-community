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
import type { Context } from '@deepseek-ai/cordis'

/** Trust surface consumed here; the browser-side connection package owns the full type. */
interface ProxyConnection {
  requestRejection(request: { readonly headers: IncomingMessage['headers'] }): 401 | 403 | undefined
}

function connectionOf(ctx: Context): ProxyConnection | undefined {
  return (ctx as unknown as { connection?: ProxyConnection }).connection
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
}

/**
 * Handle incoming dynamic proxy requests on `/proxy/:port/*`.
 *
 * @param req - The incoming HTTP request.
 * @param res - The server HTTP response.
 * @param ctx - The Cordis context carrying webServer and connection services.
 * @returns A promise resolving when the proxy request cycle completes.
 */
export async function handleProxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: Context,
): Promise<void> {
  try {
    // 1. Connection security / authentication fence
    try {
      const rejection = connectionOf(ctx)?.requestRejection(req)
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

    const portStr = match[1] ?? ''
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
    const targetPath = (rest || '/') + search
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
    if (req.socket.remoteAddress) {
      forwardHeaders['x-forwarded-for'] = req.socket.remoteAddress
    }

    await new Promise<void>((resolve) => {
      let resolved = false
      const finish = (): void => {
        if (!resolved) {
          resolved = true
          resolve()
        }
      }

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

        // Forward response headers with location rewriting and hop-by-hop stripping
        for (const [key, value] of Object.entries(targetRes.headers)) {
          if (value === undefined) continue
          const lower = key.toLowerCase()
          if (HOP_BY_HOP_HEADERS.has(lower)) continue

          if (lower === 'location' && typeof value === 'string') {
            res.setHeader(key, rewriteLocation(value, port))
          } else {
            try {
              res.setHeader(key, value)
            } catch {
              // Ignore invalid header names or values from dev servers
            }
          }
        }

        targetRes.pipe(res)
        targetRes.on('end', finish)
        targetRes.on('error', () => {
          if (!res.writableEnded) res.end()
          finish()
        })
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
