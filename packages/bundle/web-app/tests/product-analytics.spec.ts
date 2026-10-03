import OTel from '@deepseek-ai/dsh-otel'
/** Desktop-only collector policy and bounded shutdown against an unresponsive receiver. */
import { createServer } from 'node:http'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import * as Telemetry from '@deepseek-ai/dsh-host-product-telemetry-otel'
import Analytics from '@deepseek-ai/dsh-client-product-analytics'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'

afterEach(() => { vi.unstubAllEnvs() })

it.each([
  { profile: 'web', enabledEnv: undefined, disabledEnv: undefined },
  { profile: 'web', enabledEnv: '1', disabledEnv: undefined },
  { profile: 'desktop', enabledEnv: undefined, disabledEnv: undefined },
  { profile: 'desktop', enabledEnv: '1', disabledEnv: undefined },
  { profile: 'desktop', enabledEnv: '1', disabledEnv: '1' },
  { profile: 'desktop', enabledEnv: '1', disabledEnv: '' },
])('limits collection and its shutdown to the opted-in Desktop launch: $profile, DSH_TELEMETRY_ENABLED=$enabledEnv, DSH_TELEMETRY_DISABLED=$disabledEnv', async ({ profile, enabledEnv, disabledEnv }) => {
  const received = Promise.withResolvers<undefined>()
  const server = createServer((req) => { req.resume(); req.once('end', () => { received.resolve(undefined) }) })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  onTestFinished(async () => { const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('missing collector address')
  // Stub both signals unconditionally: CI exports DSH_TELEMETRY_DISABLED=1 for
  // every workflow, so an inherited value would silently deny the opted-in case.
  vi.stubEnv('DSH_TELEMETRY_ENABLED', enabledEnv ?? '')
  vi.stubEnv('DSH_TELEMETRY_DISABLED', disabledEnv ?? '')
  vi.stubEnv('DSH_CLIENT_VERSION', 'test-version')
  vi.stubEnv('DSH_PRODUCT_ANALYTICS_OTLP_URL', `http://127.0.0.1:${address.port}/logs`)
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  ctx.provide('profileContext', {
    name: profile, dir: '/profile', patchPath: '/profile/cordis.patch.yml', installAnchor: '/profile/package.json',
    cwd: '/workspace', home: '/home', startedBundles: [], overlays: [], telemetryDisabledEnv: undefined,
  })
  const identity = vi.fn().mockResolvedValue(undefined)
  ctx.provide('deepseekAccount', { getDeviceIdentity: identity } as never)
  await ctx.plugin(OTel)
  ctx.baseUrl = 'file:///'
  await ctx.plugin(Loader).await()
  ctx.loader.builtins.telemetry = Telemetry
  ctx.loader.builtins.analytics = Analytics
  const rows = loadOverlayPatches('analytics', fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)))
    .flatMap(patch => patch.insert ?? []).filter(row => row.id === 'desktop-product-telemetry' || row.id === 'product-analytics')
  const entries = rows.map(row => ({ ...row, name: row.id === 'desktop-product-telemetry' ? 'cordis:telemetry' : 'cordis:analytics' }))
  await ctx.loader.root.update(entries)
  await ctx.loader.await()
  const entry = ctx.loader.resolve('desktop-product-telemetry')
  // Mirrors the row expression: `!!` maps an empty DSH_TELEMETRY_DISABLED to
  // no denial, matching resolveTelemetryPatch's non-empty test.
  expect(entry.disabled).toBe(profile !== 'desktop' || !enabledEnv || !!disabledEnv)
  if (entry.disabled) {
    expect(ctx.loader.resolve('product-analytics').disabled).toBe(true)
    expect(ctx.get('productTelemetry')).toBeUndefined()
    expect(ctx.get('productAnalytics')).toBeUndefined()
    return
  }
  expect(rows[0]!.config).toMatchObject({
    scheduledDelayMillis: 30000, timeoutMillis: 15000, exportTimeoutMillis: 20000, shutdownTimeoutMillis: 2000,
  })
  const analytics = ctx.productAnalytics
  const analyticsFiber = ctx.loader.resolve('product-analytics').fiber
  const telemetryFiber = entry.fiber
  const lifetime = new AbortController()
  onTestFinished(() => { lifetime.abort() })
  const policy = analytics.watchPolicy(lifetime.signal)[Symbol.asyncIterator]()
  // Both the bundle row's config and the plugin schema default deny until an
  // explicit update opts in.
  expect(await policy.next()).toEqual({ value: false, done: false })
  for (const enabled of [true, false]) {
    const changed = policy.next()
    await ctx.loader.root.update(entries.map(row => row.id === 'product-analytics'
      ? { ...row, config: { ...row.config as Record<string, unknown>, enabled } } : row))
    await ctx.loader.await()
    expect(await changed).toEqual({ value: enabled, done: false })
    expect(ctx.loader.resolve('product-analytics').fiber === analyticsFiber).toBe(true)
    expect(entry.fiber === telemetryFiber).toBe(true)
    if (!enabled) {
      await analytics.report({ eventName: 'desktop_app_launch', timestamp: 1, attributes: {} })
      expect(identity).not.toHaveBeenCalled()
    }
  }
  // The loop ended on the deny state; re-enable for the delivery assertion.
  const resumed = policy.next()
  await ctx.loader.root.update(entries.map(row => row.id === 'product-analytics'
    ? { ...row, config: { ...row.config as Record<string, unknown>, enabled: true } } : row))
  await ctx.loader.await()
  expect(await resumed).toEqual({ value: true, done: false })
  const emit = vi.spyOn(ctx.productTelemetry, 'emit')
  await analytics.report({ eventName: 'desktop_app_launch', timestamp: 1, attributes: {} })
  expect(emit).toHaveBeenCalledWith(expect.objectContaining({ attributes: { app_version: 'test-version' } }))
  lifetime.abort()
  await policy.return?.()
  ctx.productTelemetry.emit({ eventName: 'desktop_upgrade_install_restart_click', body: 'upgrade', timestamp: Date.now() })
  const disposal = entry.fiber!.dispose()
  await received.promise
  await disposal
})
