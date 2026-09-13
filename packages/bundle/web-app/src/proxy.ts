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

export const PROXY_ROUTE_PREFIX = '/proxy'

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
  // 1. Connection security / authentication fence
  const rejection = connectionOf(ctx)?.requestRejection(req)
  if (rejection !== undefined) {
    res.statusCode = rejection
    res.end()
    return
  }

  // 2. Parse URL and extract port
  const fullUrl = new URL(req.url ?? '/', 'http://localhost')
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
  if (port === ctx.webServer.port) {
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
  const forwardHeaders: http.OutgoingHttpHeaders = { ...req.headers }
  forwardHeaders.host = `127.0.0.1:${String(port)}`
  forwardHeaders['x-forwarded-host'] = req.headers.host ?? `127.0.0.1:${String(ctx.webServer.port)}`
  forwardHeaders['x-forwarded-proto'] = 'http'
  if (req.socket.remoteAddress) {
    forwardHeaders['x-forwarded-for'] = req.socket.remoteAddress
  }

  await new Promise<void>((resolve) => {
    const targetReq = http.request({
      hostname: '127.0.0.1',
      port,
      path: targetPath,
      method: req.method,
      headers: forwardHeaders,
    }, (targetRes) => {
      res.statusCode = targetRes.statusCode ?? 200

      // Forward response headers with location rewriting
      for (const [key, value] of Object.entries(targetRes.headers)) {
        if (value === undefined) continue
        if (key.toLowerCase() === 'location' && typeof value === 'string') {
          let rewritten = value
          const loopbackPrefix = `http://127.0.0.1:${String(port)}`
          const localhostPrefix = `http://localhost:${String(port)}`
          if (rewritten.startsWith(loopbackPrefix)) {
            rewritten = `${PROXY_ROUTE_PREFIX}/${String(port)}${rewritten.slice(loopbackPrefix.length)}`
          } else if (rewritten.startsWith(localhostPrefix)) {
            rewritten = `${PROXY_ROUTE_PREFIX}/${String(port)}${rewritten.slice(localhostPrefix.length)}`
          } else if (rewritten.startsWith('/') && !rewritten.startsWith(`${PROXY_ROUTE_PREFIX}/${String(port)}`)) {
            rewritten = `${PROXY_ROUTE_PREFIX}/${String(port)}${rewritten}`
          }
          res.setHeader(key, rewritten)
        } else {
          res.setHeader(key, value)
        }
      }

      targetRes.pipe(res)
      targetRes.on('end', () => { resolve() })
      targetRes.on('error', () => {
        if (!res.writableEnded) res.end()
        resolve()
      })
    })

    targetReq.on('error', (err: NodeJS.ErrnoException) => {
      if (res.headersSent) {
        res.destroy()
        resolve()
        return
      }
      res.statusCode = 502
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({
        error: 'bad-gateway',
        message: `No service is reachable on internal port ${String(port)} (${err.code ?? err.message}).`,
      }))
      resolve()
    })

    req.pipe(targetReq)
  })
}
