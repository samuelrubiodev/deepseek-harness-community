import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { handleProxyRequest, PROXY_ROUTE_PREFIX } from '../src/proxy.ts'

describe('dynamic port proxy', () => {
  const serversToClose: Server[] = []

  afterEach(async () => {
    while (serversToClose.length > 0) {
      const s = serversToClose.pop()
      await new Promise<void>((resolve) => {
        s?.close(() => {
          resolve()
        })
      })
    }
  })

  async function createProxyServer(ctx: Context): Promise<number> {
    const server = createServer((req, res) => {
      void handleProxyRequest(req, res, ctx)
    })
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        resolve()
      })
    })
    serversToClose.push(server)
    return (server.address() as AddressInfo).port
  }

  function createMockCtx(webServerPort = 3080, rejection?: 401 | 403): Context {
    const ctx = new Context()
    Reflect.set(ctx, 'webServer', { port: webServerPort })
    if (rejection !== undefined) {
      Reflect.set(ctx, 'connection', { requestRejection: () => rejection })
    }
    return ctx
  }

  it('declares the /proxy prefix constant', () => {
    expect(PROXY_ROUTE_PREFIX).toBe('/proxy')
  })

  it('rejects unauthenticated or untrusted requests via connection service', async () => {
    const ctx = createMockCtx(3080, 403)
    const proxyPort = await createProxyServer(ctx)

    const res = await fetch(`http://127.0.0.1:${String(proxyPort)}/proxy/8080/`, { redirect: 'manual' })
    expect(res.status).toBe(403)
  })

  it('rejects invalid proxy paths and ports', async () => {
    const ctx = createMockCtx(3080)
    const proxyPort = await createProxyServer(ctx)

    for (const path of ['/proxy', '/proxy/invalid/', '/proxy/99999/']) {
      const res = await fetch(`http://127.0.0.1:${String(proxyPort)}${path}`, { redirect: 'manual' })
      expect(res.status).toBe(400)
      const body = await res.json() as { error?: string }
      expect(body).toHaveProperty('error')
    }
  })

  it('rejects proxy loops back to the webserver port', async () => {
    const ctx = createMockCtx(3080)
    const proxyPort = await createProxyServer(ctx)

    const res = await fetch(`http://127.0.0.1:${String(proxyPort)}/proxy/3080/`, { redirect: 'manual' })
    expect(res.status).toBe(400)
    const body = await res.json() as { error?: string }
    expect(body.error).toBe('proxy-loop')
  })

  it('redirects bare /proxy/<port> to /proxy/<port>/', async () => {
    const ctx = createMockCtx(3080)
    const proxyPort = await createProxyServer(ctx)

    const res = await fetch(`http://127.0.0.1:${String(proxyPort)}/proxy/8210?view=1`, { redirect: 'manual' })
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('/proxy/8210/?view=1')
  })

  it('returns 502 Bad Gateway when target port is unreachable', async () => {
    const ctx = createMockCtx(3080)
    const proxyPort = await createProxyServer(ctx)

    const res = await fetch(`http://127.0.0.1:${String(proxyPort)}/proxy/65432/`, { redirect: 'manual' })
    expect(res.status).toBe(502)
    const body = await res.json() as { error?: string }
    expect(body.error).toBe('bad-gateway')
  })

  it('proxies requests to a live local server and rewrites relative Location redirects', async () => {
    const targetServer = createServer((req, res) => {
      if (req.url === '/redirect') {
        res.writeHead(302, { location: '/target-page' })
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end(`echo from target: ${req.url ?? ''}`)
    })

    await new Promise<void>((resolve) => {
      targetServer.listen(0, '127.0.0.1', () => {
        resolve()
      })
    })
    serversToClose.push(targetServer)
    const targetPort = (targetServer.address() as AddressInfo).port

    const ctx = createMockCtx(3080)
    const proxyPort = await createProxyServer(ctx)

    // 1. Normal proxied request
    {
      const res = await fetch(`http://127.0.0.1:${String(proxyPort)}/proxy/${String(targetPort)}/hello/world?q=1`, {
        redirect: 'manual',
      })
      expect(res.status).toBe(200)
      const text = await res.text()
      expect(text).toBe('echo from target: /hello/world?q=1')
    }

    // 2. Location header rewrite on redirect
    {
      const res = await fetch(`http://127.0.0.1:${String(proxyPort)}/proxy/${String(targetPort)}/redirect`, {
        redirect: 'manual',
      })
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe(`/proxy/${String(targetPort)}/target-page`)
    }
  })

  it('strips hop-by-hop headers and sets x-no-compression on proxied responses', async () => {
    const targetServer = createServer((_req, res) => {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'proxy-authenticate': 'Basic realm="internal"',
        'custom-header': 'safe-value',
      })
      res.end('<h1>Hello from internal dev server</h1>')
    })

    await new Promise<void>((resolve) => {
      targetServer.listen(0, '127.0.0.1', () => {
        resolve()
      })
    })
    serversToClose.push(targetServer)
    const targetPort = (targetServer.address() as AddressInfo).port

    const ctx = createMockCtx(3080)
    const proxyPort = await createProxyServer(ctx)

    const res = await fetch(`http://127.0.0.1:${String(proxyPort)}/proxy/${String(targetPort)}/`)
    expect(res.status).toBe(200)
    expect(res.headers.get('x-no-compression')).toBe('1')
    expect(res.headers.get('custom-header')).toBe('safe-value')
    expect(res.headers.get('proxy-authenticate')).toBeNull()
    const html = await res.text()
    expect(html).toContain('Hello from internal dev server')
  })

  it('forwards request body on POST requests', async () => {
    let receivedBody = ''
    const targetServer = createServer((req, res) => {
      req.setEncoding('utf8')
      req.on('data', (chunk: Buffer | string) => {
        receivedBody += chunk.toString()
      })
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, received: receivedBody }))
      })
    })

    await new Promise<void>((resolve) => {
      targetServer.listen(0, '127.0.0.1', () => {
        resolve()
      })
    })
    serversToClose.push(targetServer)
    const targetPort = (targetServer.address() as AddressInfo).port

    const ctx = createMockCtx(3080)
    const proxyPort = await createProxyServer(ctx)

    const res = await fetch(`http://127.0.0.1:${String(proxyPort)}/proxy/${String(targetPort)}/api/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ping: 'pong' }),
    })
    expect(res.status).toBe(200)
    const data = await res.json() as { ok: boolean; received: string }
    expect(data.ok).toBe(true)
    expect(data.received).toBe(JSON.stringify({ ping: 'pong' }))
  })

  it('handles trust evaluation errors safely by returning 403', async () => {
    const ctx = new Context()
    Reflect.set(ctx, 'webServer', { port: 3080 })
    Reflect.set(ctx, 'connection', {
      requestRejection: () => {
        throw new Error('Unexpected connection evaluation error')
      },
    })
    const proxyPort = await createProxyServer(ctx)

    const res = await fetch(`http://127.0.0.1:${String(proxyPort)}/proxy/8080/`, { redirect: 'manual' })
    expect(res.status).toBe(403)
    const body = await res.json() as { error?: string }
    expect(body.error).toBe('forbidden')
  })

  it('handles 401 rejection with structured JSON error response', async () => {
    const ctx = createMockCtx(3080, 401)
    const proxyPort = await createProxyServer(ctx)

    const res = await fetch(`http://127.0.0.1:${String(proxyPort)}/proxy/8080/`, { redirect: 'manual' })
    expect(res.status).toBe(401)
    const body = await res.json() as { error?: string; message?: string }
    expect(body.error).toBe('unauthorized')
    expect(body.message).toContain('Authentication required')
  })
})
