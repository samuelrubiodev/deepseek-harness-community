import { createServer, IncomingMessage, type Server } from 'node:http'
import { Duplex } from 'node:stream'
import { connect, Socket, type AddressInfo } from 'node:net'
import { once } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  handleProxyRequest,
  handleProxyUpgrade,
  handleProxyUpgradeFallback,
  proxyPortFromReferer,
  PROXY_ROUTE_PREFIX,
  rewriteHtml,
} from '../src/proxy.ts'

describe('dynamic port proxy', () => {
  const serversToClose: Server[] = []
  const socketsToDestroy: Socket[] = []

  afterEach(async () => {
    while (socketsToDestroy.length > 0) {
      const sock = socketsToDestroy.pop()
      sock?.destroy()
    }
    while (serversToClose.length > 0) {
      const s = serversToClose.pop()
      s?.closeAllConnections?.()
      await new Promise<void>((resolve) => {
        s?.close(() => {
          resolve()
        })
      })
    }
  })

  async function createProxyServer(ctx: Context, upgradeMode?: 'normal' | 'fallback'): Promise<number> {
    const server = createServer((req, res) => {
      void handleProxyRequest(req, res, ctx)
    })
    if (upgradeMode === 'normal') {
      server.on('upgrade', (req, socket, head) => {
        void handleProxyUpgrade(req, socket, head, ctx)
      })
    } else if (upgradeMode === 'fallback') {
      server.on('upgrade', (req, socket, head) => {
        void handleProxyUpgradeFallback(req, socket, head, ctx)
      })
    }
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        resolve()
      })
    })
    serversToClose.push(server)
    return (server.address() as AddressInfo).port
  }

  async function rawUpgrade(
    port: number,
    path: string,
    headers: Record<string, string> = {},
  ): Promise<{ socket: Socket; responseText: string }> {
    const socket = connect(port, '127.0.0.1')
    socketsToDestroy.push(socket)
    await once(socket, 'connect')
    const headerLines = [
      `GET ${path} HTTP/1.1`,
      `Host: 127.0.0.1:${String(port)}`,
      'Origin: http://deepseek.lan',
      'Connection: Upgrade',
      'Upgrade: websocket',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Version: 13',
    ]
    for (const [key, val] of Object.entries(headers)) {
      headerLines.push(`${key}: ${val}`)
    }
    headerLines.push('', '')
    socket.write(headerLines.join('\r\n'))
    const chunk = await new Promise<string>((resolve) => {
      socket.once('data', (buf: Buffer) => {
        resolve(buf.toString('utf8'))
      })
      socket.once('close', () => {
        resolve('')
      })
      socket.once('end', () => {
        resolve('')
      })
    })
    return { socket, responseText: chunk }
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
      if (req.url === '/redirect-loopback') {
        res.writeHead(302, { location: `http://127.0.0.1:${String(targetPort)}/target-page` })
        res.end()
        return
      }
      if (req.url === '/redirect-localhost') {
        res.writeHead(302, { location: `http://localhost:${String(targetPort)}/target-page` })
        res.end()
        return
      }
      if (req.url === '/redirect-external') {
        res.writeHead(302, { location: 'https://example.com/other' })
        res.end()
        return
      }
      if (req.url === '/redirect-already-proxied') {
        res.writeHead(302, { location: `/proxy/${String(targetPort)}/target-page` })
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

    // 2. Relative Location header rewrite on redirect
    {
      const res = await fetch(`http://127.0.0.1:${String(proxyPort)}/proxy/${String(targetPort)}/redirect`, {
        redirect: 'manual',
      })
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe(`/proxy/${String(targetPort)}/target-page`)
    }

    // 3. Loopback Location rewrite
    {
      const res = await fetch(`http://127.0.0.1:${String(proxyPort)}/proxy/${String(targetPort)}/redirect-loopback`, {
        redirect: 'manual',
      })
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe(`/proxy/${String(targetPort)}/target-page`)
    }

    // 4. Localhost Location rewrite
    {
      const res = await fetch(`http://127.0.0.1:${String(proxyPort)}/proxy/${String(targetPort)}/redirect-localhost`, {
        redirect: 'manual',
      })
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe(`/proxy/${String(targetPort)}/target-page`)
    }

    // 5. External Location unchanged
    {
      const res = await fetch(`http://127.0.0.1:${String(proxyPort)}/proxy/${String(targetPort)}/redirect-external`, {
        redirect: 'manual',
      })
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('https://example.com/other')
    }

    // 6. Already proxied Location unchanged
    {
      const res = await fetch(`http://127.0.0.1:${String(proxyPort)}/proxy/${String(targetPort)}/redirect-already-proxied`, {
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

  it('safely tolerates cordis context throwing when accessing connection property', async () => {
    const ctx = new Context()
    Reflect.set(ctx, 'webServer', { port: 3080 })
    Object.defineProperty(ctx, 'connection', {
      get() {
        throw new Error('cannot get property "connection" without inject')
      },
    })
    const proxyPort = await createProxyServer(ctx)

    // With no unreachable service, it fails at target connect, returning 502 instead of crashing with 403 or 500
    const res = await fetch(`http://127.0.0.1:${String(proxyPort)}/proxy/65432/`, { redirect: 'manual' })
    expect(res.status).toBe(502)
  })

  it('handles malformed request URL returning 400 invalid-url', async () => {
    const ctx = createMockCtx(3080)
    let handledStatus = 0
    let handledBody = ''
    const fakeReq = {
      url: 'http://[bad-url',
      headers: {},
      socket: {},
      method: 'GET',
    }
    const fakeRes = {
      set statusCode(val: number) {
        handledStatus = val
      },
      setHeader() {},
      end(body?: string) {
        handledBody = body ?? ''
      },
    }
    await handleProxyRequest(
      fakeReq as unknown as import('node:http').IncomingMessage,
      fakeRes as unknown as import('node:http').ServerResponse,
      ctx,
    )
    expect(handledStatus).toBe(400)
    expect(handledBody).toContain('invalid-url')
  })

  it('rewrites HTML tags and injects base and client shim correctly', () => {
    const inputHtml = `<!DOCTYPE html>
<html>
<head>
  <title>Test Page</title>
  <link rel="stylesheet" href="/styles.css">
  <link rel="icon" href="/favicon.ico">
</head>
<body>
  <script src="/main.js"></script>
  <img src="/assets/dragonfly.png">
  <a href="/about">About</a>
  <a href="https://external.com">External</a>
  <a href="//cdn.jsdelivr.net/three.js">CDN</a>
  <a href="/proxy/8123/existing">Existing</a>
  <form action="/submit" method="post"></form>
</body>
</html>`

    const outputHtml = rewriteHtml(inputHtml, 8123)
    expect(outputHtml).toContain('<base href="/proxy/8123/">')
    expect(outputHtml).toContain('href="/proxy/8123/styles.css"')
    expect(outputHtml).toContain('href="/proxy/8123/favicon.ico"')
    expect(outputHtml).toContain('src="/proxy/8123/main.js"')
    expect(outputHtml).toContain('src="/proxy/8123/assets/dragonfly.png"')
    expect(outputHtml).toContain('href="/proxy/8123/about"')
    expect(outputHtml).toContain('action="/proxy/8123/submit"')
    expect(outputHtml).toContain('href="https://external.com"')
    expect(outputHtml).toContain('href="//cdn.jsdelivr.net/three.js"')
    expect(outputHtml).toContain('href="/proxy/8123/existing"')
    expect(outputHtml).not.toContain('/proxy/8123/proxy/8123/')
    expect(outputHtml).toContain("const base = '/proxy/8123';")

    const baseHtml = '<html><head><base href="/"></head><body><script>import x from \'/lib/x.js\'</script></body></html>'
    const outputBase = rewriteHtml(baseHtml, 8123)
    expect(outputBase).toContain('<base href="/proxy/8123/">')
    expect(outputBase).toContain("from '/proxy/8123/lib/x.js'")
  })

  it('proxies HTML responses, buffering and rewriting root-relative asset paths', async () => {
    const htmlBody = '<html><head><title>App</title><link rel="stylesheet" href="/styles.css"></head><body><script src="/main.js"></script></body></html>'
    const targetServer = createServer((_req, res) => {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': String(Buffer.byteLength(htmlBody)),
      })
      res.end(htmlBody)
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
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
    const html = await res.text()
    expect(html).toContain(`/proxy/${String(targetPort)}/styles.css`)
    expect(html).toContain(`/proxy/${String(targetPort)}/main.js`)
    expect(html).toContain(`<base href="/proxy/${String(targetPort)}/">`)
  })

  it('extracts proxy target port from Referer header with proxyPortFromReferer', () => {
    expect(proxyPortFromReferer('http://deepseek.lan/proxy/8123/')).toBe(8123)
    expect(proxyPortFromReferer('http://deepseek.lan/proxy/5173/nested/path?token=abc')).toBe(5173)
    expect(proxyPortFromReferer('http://deepseek.lan/proxy/99999/')).toBeUndefined()
    expect(proxyPortFromReferer('http://deepseek.lan/about')).toBeUndefined()
    expect(proxyPortFromReferer(undefined)).toBeUndefined()
    expect(proxyPortFromReferer('not-a-valid-url')).toBeUndefined()
  })

  it('client shim patches WebSocket and EventSource to preserve proxy path', () => {
    const html = rewriteHtml('<html><head></head><body></body></html>', 5173)
    expect(html).toContain('class ProxiedWebSocket extends OrigWebSocket')
    expect(html).toContain('class ProxiedEventSource extends OrigEventSource')
    expect(html).toContain("const base = '/proxy/5173';")
  })

  it('proxies WebSocket upgrade requests to target dev server', async () => {
    let receivedUpgradePath = ''
    let serverSocketEchoed = false

    const targetServer = createServer()
    targetServer.on('upgrade', (req, socket) => {
      socketsToDestroy.push(socket as Socket)
      receivedUpgradePath = req.url ?? ''
      socket.write([
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=',
        '',
        '',
      ].join('\r\n'))
      socket.on('data', (data: Buffer) => {
        if (data.toString('utf8').includes('ping-from-client')) {
          serverSocketEchoed = true
          socket.write('pong-from-server')
        }
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
    const proxyPort = await createProxyServer(ctx, 'normal')

    const { socket: clientSocket, responseText } = await rawUpgrade(
      proxyPort,
      `/proxy/${String(targetPort)}/?token=hmr-token`,
    )
    expect(responseText).toContain('101 Switching Protocols')
    expect(receivedUpgradePath).toBe('/?token=hmr-token')

    // Test bidirectional data flow
    const receivedDataPromise = once(clientSocket, 'data')
    clientSocket.write('ping-from-client')
    const [pongData] = (await receivedDataPromise) as [Buffer]
    expect(serverSocketEchoed).toBe(true)
    expect(pongData.toString('utf8')).toBe('pong-from-server')
    clientSocket.destroy()
  })

  it('rejects WebSocket upgrades when connection trust fence fails', async () => {
    const ctx = createMockCtx(3080, 403)
    const proxyPort = await createProxyServer(ctx, 'normal')

    const { socket, responseText } = await rawUpgrade(proxyPort, '/proxy/5173/')
    expect(responseText).toContain('HTTP/1.1 403 Forbidden')
    socket.destroy()
  })

  it('rejects WebSocket upgrades with invalid ports or webServer loops', async () => {
    const ctx = createMockCtx(3080)
    const proxyPort = await createProxyServer(ctx, 'normal')

    const { socket: sock1, responseText: res1 } = await rawUpgrade(proxyPort, '/proxy/notaport/')
    expect(res1).toContain('HTTP/1.1 400 Bad Request')
    sock1.destroy()

    const { socket: sock2, responseText: res2 } = await rawUpgrade(proxyPort, '/proxy/3080/')
    expect(res2).toContain('HTTP/1.1 400 Bad Request')
    sock2.destroy()
  })

  it('returns 502 Bad Gateway when upgrade target port is unreachable', async () => {
    const ctx = createMockCtx(3080)
    const proxyPort = await createProxyServer(ctx, 'normal')

    // 65530 is unlikely to be listening
    const { socket, responseText } = await rawUpgrade(proxyPort, '/proxy/65530/')
    expect(responseText).toContain('HTTP/1.1 502 Bad Gateway')
    socket.destroy()
  })

  it('proxies fallback WebSocket upgrades via Referer header', async () => {
    let receivedUpgradePath = ''

    const targetServer = createServer()
    targetServer.on('upgrade', (req, socket) => {
      socketsToDestroy.push(socket as Socket)
      receivedUpgradePath = req.url ?? ''
      socket.write([
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=',
        '',
        '',
      ].join('\r\n'))
    })

    await new Promise<void>((resolve) => {
      targetServer.listen(0, '127.0.0.1', () => {
        resolve()
      })
    })
    serversToClose.push(targetServer)
    const targetPort = (targetServer.address() as AddressInfo).port

    const ctx = createMockCtx(3080)
    const proxyPort = await createProxyServer(ctx, 'fallback')

    // Client connects to /?token=vite-token directly, but sends Referer with /proxy/<targetPort>/
    const { socket, responseText } = await rawUpgrade(
      proxyPort,
      '/?token=vite-token',
      { Referer: `http://deepseek.lan/proxy/${String(targetPort)}/` },
    )
    expect(responseText).toContain('101 Switching Protocols')
    expect(receivedUpgradePath).toBe('/?token=vite-token')
    socket.destroy()
  })

  it('destroys socket on fallback WebSocket upgrade without valid proxy Referer', async () => {
    const ctx = createMockCtx(3080)
    const proxyPort = await createProxyServer(ctx, 'fallback')

    const { responseText } = await rawUpgrade(proxyPort, '/unmatched-ws')
    expect(responseText).toBe('')

    const { responseText: res2 } = await rawUpgrade(proxyPort, '/unmatched-ws', { Referer: 'http://deepseek.lan/about' })
    expect(res2).toBe('')
  })

  it('forwards standard HTTP response when target dev server rejects WebSocket upgrade', async () => {
    const targetServer = createServer((_req, res) => {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('Not found')
    })
    await new Promise<void>((resolve) => {
      targetServer.listen(0, '127.0.0.1', () => {
        resolve()
      })
    })
    serversToClose.push(targetServer)
    const targetPort = (targetServer.address() as AddressInfo).port

    const ctx = createMockCtx(3080)
    const proxyPort = await createProxyServer(ctx, 'normal')

    const { socket, responseText } = await rawUpgrade(proxyPort, `/proxy/${String(targetPort)}/`)
    expect(responseText).toContain('HTTP/1.1 404')
    expect(responseText).toContain('Not found')
    socket.destroy()
  })

  it('buffers and flushes initial head bytes in WebSocket upgrades', async () => {
    const targetServer = createServer()
    targetServer.on('upgrade', (_req, socket) => {
      socketsToDestroy.push(socket as Socket)
      socket.write([
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=',
        '',
        'initial-target-bytes',
      ].join('\r\n'))
      socket.on('data', (data: Buffer) => {
        socket.write(`echo:${data.toString('utf8')}`)
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
    const clientReq = new IncomingMessage(new Socket())
    clientReq.url = `/proxy/${String(targetPort)}/`
    clientReq.headers = { host: 'deepseek.lan', upgrade: 'websocket', connection: 'Upgrade' }

    const written: Buffer[] = []
    const clientSocket = new Duplex({
      read() {},
      write(chunk: unknown, _enc: unknown, cb: () => void) {
        written.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
        cb()
      },
    })
    socketsToDestroy.push(clientSocket as unknown as Socket)

    await handleProxyUpgrade(clientReq, clientSocket, Buffer.from('client-head-bytes'), ctx)
    await new Promise(r => setTimeout(r, 50))
    const total = Buffer.concat(written).toString('utf8')
    expect(total).toContain('101 Switching Protocols')
    expect(total).toContain('initial-target-bytes')
    expect(total).toContain('echo:client-head-bytes')
    clientSocket.destroy()
  })

  it('handles upgrade errors when trust evaluation throws', async () => {
    const ctx = new Context()
    Reflect.set(ctx, 'connection', {
      requestRejection: () => {
        throw new Error('trust check exploded')
      },
    })
    const clientReq = new IncomingMessage(new Socket())
    clientReq.url = '/proxy/5173/'
    clientReq.headers = { host: 'deepseek.lan', upgrade: 'websocket', connection: 'Upgrade' }

    const written: Buffer[] = []
    const clientSocket = new Duplex({
      read() {},
      write(chunk: unknown, _enc: unknown, cb: () => void) {
        written.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
        cb()
      },
    })
    await handleProxyUpgrade(clientReq, clientSocket, Buffer.alloc(0), ctx)
    const res = Buffer.concat(written).toString('utf8')
    expect(res).toContain('HTTP/1.1 403 Forbidden')
  })

  it('handles upgrade errors when request URL is malformed', async () => {
    const ctx = createMockCtx(3080)
    const clientReq = new IncomingMessage(new Socket())
    clientReq.url = 'http://[invalid-url'
    clientReq.headers = { host: 'deepseek.lan', upgrade: 'websocket', connection: 'Upgrade' }

    const written: Buffer[] = []
    const clientSocket = new Duplex({
      read() {},
      write(chunk: unknown, _enc: unknown, cb: () => void) {
        written.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
        cb()
      },
    })
    await handleProxyUpgrade(clientReq, clientSocket, Buffer.alloc(0), ctx)
    const res = Buffer.concat(written).toString('utf8')
    expect(res).toContain('HTTP/1.1 400 Bad Request')
  })

  it('finishes safely when client socket is destroyed before target server responds to upgrade', async () => {
    const targetServer = createServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200)
        res.end()
      }, 50)
    })
    await new Promise<void>((resolve) => {
      targetServer.listen(0, '127.0.0.1', () => {
        resolve()
      })
    })
    serversToClose.push(targetServer)
    const targetPort = (targetServer.address() as AddressInfo).port

    const ctx = createMockCtx(3080)
    const clientReq = new IncomingMessage(new Socket())
    clientReq.url = `/proxy/${String(targetPort)}/`
    clientReq.headers = { host: 'deepseek.lan', upgrade: 'websocket', connection: 'Upgrade' }

    const clientSocket = new Duplex({
      read() {},
      write(_chunk: unknown, _enc: unknown, cb: () => void) {
        cb()
      },
    })
    // Immediately destroy the client socket
    clientSocket.destroy()

    await handleProxyUpgrade(clientReq, clientSocket, Buffer.alloc(0), ctx)
    await new Promise(r => setTimeout(r, 100))
  })

  it('handles HEAD requests through proxy', async () => {
    const targetServer = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end()
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

    const res = await fetch(`http://127.0.0.1:${String(proxyPort)}/proxy/${String(targetPort)}/`, { method: 'HEAD' })
    expect(res.status).toBe(200)
  })

  it('rejects WebSocket upgrades with 401 Unauthorized when unauthenticated', async () => {
    const ctx = createMockCtx(3080, 401)
    const proxyPort = await createProxyServer(ctx, 'normal')

    const { socket, responseText } = await rawUpgrade(proxyPort, '/proxy/5173/')
    expect(responseText).toContain('HTTP/1.1 401 Unauthorized')
    socket.destroy()
  })

  it('handles bare /proxy/:port without trailing slash in upgrade', async () => {
    const targetServer = createServer()
    targetServer.on('upgrade', (_req, socket) => {
      socketsToDestroy.push(socket as Socket)
      socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
    })
    await new Promise<void>((resolve) => {
      targetServer.listen(0, '127.0.0.1', () => {
        resolve()
      })
    })
    serversToClose.push(targetServer)
    const targetPort = (targetServer.address() as AddressInfo).port

    const ctx = createMockCtx(3080)
    const proxyPort = await createProxyServer(ctx, 'normal')

    const { socket, responseText } = await rawUpgrade(proxyPort, `/proxy/${String(targetPort)}`)
    expect(responseText).toContain('101 Switching Protocols')
    socket.destroy()
  })
})
