/** Default token authentication, HTTP exchanges, and entry URL contribution. */
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-credentials'
import { CONNECT_PATH } from '@deepseek-ai/dsh-client-connection'
import type { ConnectionTrustRequest, PeerScope } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { BrowserAuth, type BrowserAuthMode } from './browser-auth.ts'

/** Stable plugin name. */
export const name = 'host-authentication-token'
/** Services owning request admission and the persistent signing key. */
export const inject = ['connection', 'connection.authentication', 'credentials']

/** Browser token authentication, cookie lifetime, and reverse-proxy header configuration. */
export interface Config {
  /** Absolute cookie lifetime in days; default 30. */
  cookieMaxAgeDays: number
  /** Whether to trust standard X-Forwarded-Host and X-Forwarded-Proto reverse proxy headers. */
  reverseProxy?: boolean
  /**
   * How browsers authenticate: `token` keeps the launch-token exchange and
   * signed session cookie; `none` lets any request that passes the Host/Origin
   * trust fence reach the UI and API with no token or cookie. The
   * `DSH_AUTH_MODE` environment variable is the fallback when unset.
   */
  authMode?: BrowserAuthMode
  /**
   * Fixed access token served at `/?token=<value>`, replacing the random
   * per-process launch token so the sign-in URL survives restarts. The
   * `DSH_AUTH_TOKEN` environment variable is the fallback when unset.
   */
  authToken?: string
}

/** Validate cookie lifetime and optional auth settings before preparing the token implementation. */
export const Config: z<Config> = z.object({
  cookieMaxAgeDays: z.natural().min(1).default(30),
  // Bare (optional) so the documented env fallbacks reach the plugin
  // instead of being shadowed by a schema default the Loader always applies.
  reverseProxy: z.boolean(),
  authMode: z.union([z.const('token'), z.const('none')]),
  authToken: z.string(),
})

/**
 * Register the token provider and its optional Web transport integration.
 * @param ctx - plugin scope owning the shared Peer and registrations.
 * @param config - validated browser and API cookie lifetime and auth mode configuration.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const reverseProxy = config.reverseProxy ?? (process.env.DSH_REVERSE_PROXY === 'true' || process.env.DSH_REVERSE_PROXY === '1')
  const authMode: BrowserAuthMode = config.authMode ?? (process.env.DSH_AUTH_MODE === 'none' ? 'none' : 'token')
  const envToken = process.env.DSH_AUTH_TOKEN?.trim()
  const authToken = config.authToken ?? (envToken === undefined || envToken === '' ? undefined : envToken)
  if (config.authToken !== undefined && config.authToken.trim() === '') {
    throw new Error('host-authentication-token: authToken must not be blank')
  }
  const auth = await BrowserAuth.create(ctx[Context.root], ctx.credentials, config.cookieMaxAgeDays, reverseProxy, ctx.logger, {
    mode: authMode,
    ...authToken !== undefined && { fixedToken: authToken },
  })
  if (authMode === 'none') {
    const notice = 'host-authentication-token: browser authentication is DISABLED (authMode "none"); every request whose Host/Origin passes the trust fence reaches the UI and its code-execution tools without a token'
    ctx.logger.warn(notice)
    console.warn(notice)
  }
  const peer = ctx.connection.createPeer({ principal: { kind: 'owner' } })
  const apiPeers = new Map<PeerScope['id'], PeerScope>()
  ctx.connection.authentication.register({
    authenticate(request) {
      const secure = ctx.get('webServer')?.protocol === 'https:'
      if (auth.isAuthenticated(request, secure)) return peer
      const id = auth.authenticateApi(request, secure)
      return id === undefined ? undefined : apiPeers.get(id)
    },
  })
  ctx.inject(['webServer'], (webCtx) => {
    let active = true
    const sockets = new Map<PeerScope, () => Promise<void>>()
    webCtx.effect(() => async () => {
      active = false
      apiPeers.clear()
      await Promise.all([...sockets.values()].map(release => release()))
    }, 'host-authentication-token: API sockets')
    webCtx.on('webserver/request', async (request, response, next) => {
      const facts: ConnectionTrustRequest = request
      if (facts.socket?.destroyed || response.destroyed || facts.signal?.aborted) return
      if (!active) { await next(); return }
      const url = new URL(request.url ?? '/', 'http://dsh.invalid')
      if (url.pathname !== '/' || !url.searchParams.has('token')) {
        await next()
        return
      }
      auth.authorizeIndex(request, response, webCtx.webServer.protocol === 'https:')
    })
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact', path: CONNECT_PATH, auth: 'anonymous',
      handler(request, response) {
        const facts: ConnectionTrustRequest = request
        if (facts.socket?.destroyed || response.destroyed || facts.signal?.aborted) return
        if (!active) {
          response.writeHead(401)
          response.end('unauthorized')
          return
        }
        auth.authorizeConnect(request, response, webCtx.webServer.protocol === 'https:', (interactions) => {
          const apiPeer = webCtx.connection.createPeer({ principal: { kind: 'owner' }, interactions })
          apiPeers.set(apiPeer.id, apiPeer)
          apiPeer.ctx.effect(() => () => { apiPeers.delete(apiPeer.id) }, 'authentication-token: API credential')
          return apiPeer.id
        })
      },
    }), 'host-authentication-token: API connect')
    webCtx.on('webserver/upgrade', async (request, socket, _head, admittedPeer, next) => {
      if (admittedPeer === undefined) { await next(); return }
      if (new URL(request.url ?? '/', 'http://dsh.invalid').pathname !== '/api/remote.mux') {
        await next()
        return
      }
      if (apiPeers.get(admittedPeer.id) !== admittedPeer) {
        if (auth.authenticateApi(request, webCtx.webServer.protocol === 'https:') === admittedPeer.id) {
          socket.destroy()
          return
        }
        await next()
        return
      }
      if (!active || admittedPeer.signal.aborted) { socket.destroy(); return }
      if (sockets.has(admittedPeer)) {
        socket.end([
          'HTTP/1.1 409 Conflict',
          'Connection: close',
          'Content-Type: text/plain; charset=utf-8',
          'Content-Length: 8',
          '',
          'conflict',
        ].join('\r\n'))
        return
      }
      const closed = Promise.withResolvers<undefined>()
      let released: Promise<void> | undefined
      const release = (): Promise<void> => {
        if (released !== undefined) return released
        // Revocation precedes asynchronous Peer and stream cleanup.
        apiPeers.delete(admittedPeer.id)
        socket.destroy()
        released = Promise.all([
          closed.promise,
          admittedPeer.dispose().catch((error: unknown) => {
            console.error('[host-authentication-token] Peer release failed:', error)
          }),
        ]).then(() => {
          sockets.delete(admittedPeer)
          void disposeSocket()
        })
        return released
      }
      const failed = (): void => { void release() }
      const finish = (): void => {
        socket.removeListener('error', failed)
        socket.removeListener('close', finish)
        closed.resolve(undefined)
        void release()
      }
      sockets.set(admittedPeer, release)
      const disposeSocket = webCtx.effect(() => release, 'host-authentication-token: owned API socket')
      admittedPeer.ctx.effect(() => {
        socket.on('error', failed)
        socket.once('close', finish)
        return async () => {
          apiPeers.delete(admittedPeer.id)
          socket.destroy()
          // Await only the transport: release itself awaits this Peer disposer.
          await closed.promise
        }
      }, 'host-authentication-token: API socket')
      if (socket.closed) finish()
      if (socket.destroyed) { await release(); return }
      try {
        await next()
      } catch (error) {
        await release()
        throw error
      }
    })
  })
  ctx.on('webserver/entry-url', (baseUrl, entries) => {
    entries.push({ label: 'dsh web', url: auth.authenticatedUrl(baseUrl), open: true })
  })
}
