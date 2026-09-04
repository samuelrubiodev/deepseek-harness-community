/** Host HTTP bridge for browser-client RPC. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-credentials'
// Activates the webServer Context merge used below.
import type { IndexInjection, WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { API_PATH } from './api-path.ts'
import { bridge, DEFAULT_MAX_REQUEST_BODY_BYTES } from './http-bridge.ts'
import { assertTrustedAuthority } from './api-request-trust.ts'
import { BrowserAuth, type BrowserAuthMode } from './browser-auth.ts'
import { HostConnectionService } from './rpc-host.ts'

export type {
  ConnectionFetchMethod,
  ConnectionFetchHandler,
  ConnectionFetchRoute,
  ConnectionIndexRequest,
  ConnectionIndexResponse,
  ConnectionRpcEndpointMatcher,
  ConnectionRpcFailure,
  ConnectionRpcHandler,
  ConnectionRequestRejection,
  ConnectionRpcResult,
  ConnectionRequestBodyMode,
  ConnectionTrustRequest,
  ClientRequest,
  HostConnectionHandle,
  HostConnectionFetch,
  HostConnectionRpc,
  RpcMessage,
  ServerResponse,
} from './rpc.ts'
export { RpcId, transportError } from './rpc.ts'
export {
  clientRequestSchema,
  rpcErrorSchema,
  rpcIdSchema,
  rpcMessageSchema,
  rpcResultSchema,
  serverResponseSchema,
} from './rpc-schema.ts'
export { HostConnectionService } from './rpc-host.ts'
export {
  assertTrustedAuthority,
  evaluateApiRequestTrust,
  isTrustedApiRequest,
  type ApiRequestTrustResult,
  type TrustedApiRequestOptions,
} from './api-request-trust.ts'
export {
  BrowserAuth,
  type BrowserAuthLogger,
  type BrowserAuthMode,
  type BrowserAuthOptions,
  type BrowserAuthResult,
} from './browser-auth.ts'

export { API_PATH } from './api-path.ts'

/** Stable Cordis plugin name. */
export const name = 'client-connection'

/** Headroom for RPC JSON fields around aggregate base64 image payloads. */
const REQUEST_ENVELOPE_HEADROOM_BYTES = 1024 * 1024

function assertImageBodyCapacity(ctx: Context, maxRequestBodyBytes: number): void {
  const attachments = ctx.get('attachments')
  if (attachments === undefined) return
  const requiredImageBodyBytes = Math.ceil(
    attachments.imageLimits.maxMessageImageBytes * 4 / 3,
  ) + REQUEST_ENVELOPE_HEADROOM_BYTES
  if (maxRequestBodyBytes < requiredImageBodyBytes) {
    throw new Error(
      `client-connection maxRequestBodyBytes (${String(maxRequestBodyBytes)}) must be at least `
      + `${String(requiredImageBodyBytes)} for the configured aggregate image limit`,
    )
  }
}

/** Services required before providing Connection. */
export const inject = ['webServer', 'credentials']

/** Plugin config: the deployment's non-loopback serving authorities. */
export interface ConnectionConfig {
  /**
   * Authorities this deployment serves beyond loopback: exact `host:port`, or
   * port-less `host` matching any port. The /api trust fence refuses any
   * request whose Host is neither loopback nor listed here, so a
   * non-loopback (`0.0.0.0`) deployment must declare the names it is reached
   * by; the Web runtime derives LAN IP literals from an active all-interface
   * bind. An entry that is not a bare, canonical authority fails plugin load.
   */
  trustedHosts?: string[]
  /** Absolute browser-session lifetime in days. Default: 30. */
  cookieMaxAgeDays?: number
  /** Maximum buffered JSON body for every `/api` request. Default: 300 MiB. */
  maxRequestBodyBytes?: number
  /** Whether to trust standard X-Forwarded-Host and X-Forwarded-Proto reverse proxy headers. */
  reverseProxy?: boolean
  /**
   * How browsers authenticate: `token` keeps the launch-token exchange and
   * signed session cookie; `none` lets any request that passes the Host/Origin
   * trust fence reach the UI and API with no token or cookie. The
   * `DSH_AUTH_MODE` environment variable is the fallback when unset.
   */
  authMode?: 'token' | 'none'
  /**
   * Fixed access token served at `/?token=<value>`, replacing the random
   * per-process launch token so the sign-in URL survives restarts. The
   * `DSH_AUTH_TOKEN` environment variable is the fallback when unset.
   */
  authToken?: string
}

export const Config: z<ConnectionConfig> = z.object({
  trustedHosts: z.array(String).default([]),
  cookieMaxAgeDays: z.natural().min(1).default(30),
  maxRequestBodyBytes: z.natural().min(1).default(DEFAULT_MAX_REQUEST_BODY_BYTES),
  // Bare (optional) so the documented env fallbacks below reach the plugin
  // instead of being shadowed by a schema default the Loader always applies.
  reverseProxy: z.boolean(),
  authMode: z.union([z.const('token'), z.const('none')]),
  authToken: z.string(),
})

/**
 * Mounts the API gateway under the browser transport prefix. Every request on
 * the prefix passes the Host/Origin browser-trust fence and persistent browser
 * authentication before dispatch.
 * @param ctx - Host plugin context.
 * @param config - resolved plugin config (schema defaults applied).
 */
export async function apply(ctx: Context, config?: ConnectionConfig): Promise<void> {
  // The Loader resolves schema defaults; hand-built test contexts may pass none.
  const trustedHosts = config?.trustedHosts ?? []
  const cookieMaxAgeDays = config?.cookieMaxAgeDays ?? 30
  const maxRequestBodyBytes = config?.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES
  const reverseProxy = config?.reverseProxy ?? (process.env.DSH_REVERSE_PROXY === 'true' || process.env.DSH_REVERSE_PROXY === '1')
  const authMode: BrowserAuthMode = config?.authMode ?? (process.env.DSH_AUTH_MODE === 'none' ? 'none' : 'token')
  // A blank DSH_AUTH_TOKEN (the .env.example placeholder) means "not set";
  // an explicit blank authToken in composition is a misconfiguration and fails below.
  const envToken = process.env.DSH_AUTH_TOKEN?.trim()
  const authToken = config?.authToken ?? (envToken === undefined || envToken === '' ? undefined : envToken)
  // Config boundary: a malformed entry fails the load loudly here rather than
  // silently authorizing its hostname prefix at request time.
  for (const entry of trustedHosts) assertTrustedAuthority(entry)
  if (config?.authToken !== undefined && config.authToken.trim() === '') {
    throw new Error('client-connection: authToken must not be blank')
  }
  assertImageBodyCapacity(ctx, maxRequestBodyBytes)
  const connection = new HostConnectionService(
    ctx,
    trustedHosts,
    await BrowserAuth.create(ctx.root, ctx.credentials, cookieMaxAgeDays, reverseProxy, ctx.logger, {
      mode: authMode,
      ...authToken !== undefined && { fixedToken: authToken },
    }),
    reverseProxy,
  )
  if (authMode === 'none') {
    const notice = 'client-connection: browser authentication is DISABLED (authMode "none"); every request whose Host/Origin passes the trust fence reaches the UI and its code-execution tools without a token'
    ctx.logger.warn(notice)
    console.warn(notice)
  }
  const fetchHandler = connection.createSharedFetchHandler(API_PATH)
  const route: WebRoute = {
    kind: 'prefix',
    path: API_PATH,
    handler: async (req, res) => {
      const rejection = connection.requestRejection(req)
      if (rejection !== undefined) {
        res.writeHead(rejection)
        res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
        return
      }
      await bridge(req, res, fetchHandler, maxRequestBodyBytes)
    },
  }
  ctx.effect(() => ctx.webServer.register(route), 'client-connection: /api route')
  ctx.effect(() => {
    return ctx.on('webserver/index-inject', (table: IndexInjection[]) => {
      table.push({
        kind: 'global',
        name: '__DSH_TRUSTED_HOSTS__',
        value: trustedHosts,
      })
    })
  }, 'client-connection: trusted hosts index injection')
  ctx.inject(['attachments'], (attachmentCtx) => {
    assertImageBodyCapacity(attachmentCtx, maxRequestBodyBytes)
  })
}
