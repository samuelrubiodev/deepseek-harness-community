/**
 * The bundle's substance is its patch file: the `dsh.bundle.patch` manifest
 * field must name a real, parseable patch list.
 */

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { evaluate } from '@deepseek-ai/cordis-plugin-loader'

describe('dsh-base bundle', () => {
  it('declares a parseable patch list through the dsh.bundle.patch manifest field', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(
      readFileSync(resolve(root, 'package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    const parsed = yaml.load(
      readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    )
    expect(Array.isArray(parsed)).toBe(true)
    // The base layer is one insert list over the empty profile root.
    const rows = (parsed as { insert?: { id?: string; config?: Record<string, unknown>; disabled?: boolean }[] }[]).flatMap(
      patch => patch.insert ?? [],
    )
    expect(rows.length).toBeGreaterThan(50)
    expect(rows.some(row => row.id === 'agent-loop')).toBe(true)
    expect(rows.find(row => row.id === 'session-telemetry-otel')?.disabled).toBeUndefined()
    // Telemetry is default-denied: DISABLED mode, and no collector endpoint
    // baked in — the url is the bare opt-in environment read. The mode
    // expression carries its own disable-wins ternary, so the row denies
    // without relying on the launcher switch.
    const telemetryConfig = rows.find(row => row.id === 'session-telemetry-otel')?.config
    expect(telemetryConfig?.['mode']).toEqual({
      __jsExpr: "process.env.DSH_TELEMETRY_DISABLED ? 'DISABLED' : (process.env.DSH_TELEMETRY_MODE || 'DISABLED')",
    })
    expect((telemetryConfig?.['mode'] as { __jsExpr?: string } | undefined)?.__jsExpr)
      .toContain("DSH_TELEMETRY_DISABLED ? 'DISABLED'")
    expect((telemetryConfig?.['exporter'] as { url?: unknown } | undefined)?.url).toEqual({
      __jsExpr: 'process.env.DSH_TELEMETRY_OTLP_URL',
    })
    // The request-contribution rows deny by default, opt in through their own
    // environment variable, and the telemetry disable switch overrides — each
    // row carries the precedence itself, without relying on the launcher.
    const uploadRows = [
      ['session-log-deepseek', 'DSH_SESSION_LOG_UPLOAD'],
      ['plugin-package-inventory-deepseek', 'DSH_PLUGIN_INVENTORY_UPLOAD'],
    ] as const
    for (const [id, optInEnv] of uploadRows) {
      const expression = (rows.find(row => row.id === id)?.config?.['enabled'] as { __jsExpr: string }).__jsExpr
      const enabled = (env: Record<string, string | undefined>): boolean =>
        Boolean(evaluate({ process: { env } }, expression))
      expect(enabled({}), `${id} denies by default`).toBe(false)
      expect(enabled({ [optInEnv]: '1' }), `${id} opts in`).toBe(true)
      expect(enabled({ [optInEnv]: '1', DSH_TELEMETRY_DISABLED: '1' }), `${id} disable wins`).toBe(false)
      expect(enabled({ [optInEnv]: '', DSH_TELEMETRY_DISABLED: '' }), `${id} empty values deny`).toBe(false)
      expect(enabled({ DSH_TELEMETRY_DISABLED: '0' }), `${id} disable-only denies`).toBe(false)
    }
    expect(rows.find(row => row.id === 'hmr')).toMatchObject({
      config: { root: [] },
    })
    expect(rows.filter(row => row.id === 'subagent-codex')).toHaveLength(0)
    expect(rows.filter(row => row.id === 'subagent-claude-code')).toHaveLength(0)
    expect(rows.find(row => row.id === 'web')?.config).toMatchObject({ fetchProvider: 'http' })
    expect(rows.find(row => row.id === 'web-fetch-http')).toBeDefined()
    expect(rows.find(row => row.id === 'tool-web')?.config).toMatchObject({ fetch: true })
    expect(manifest.dependencies).not.toHaveProperty('@deepseek-ai/dsh-subagent-codex')
    expect(manifest.dependencies).not.toHaveProperty('@deepseek-ai/dsh-subagent-claude-code')
    expect(manifest.dependencies).toHaveProperty('@deepseek-ai/dsh-web-fetch-http')
  })

  it('gates each shell stack by platform with a symmetric disabled expression', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const parsed = yaml.load(
      readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8'),
      { schema: entryListSchema },
    )
    if (!Array.isArray(parsed)) throw new TypeError('base patch must parse to a patch list')
    const rows = parsed.flatMap((patch): Record<string, unknown>[] =>
      typeof patch === 'object' && patch !== null
        ? (patch as { insert?: Record<string, unknown>[] }).insert ?? []
        : [],
    )
    // Symmetric gating: each stack's executor and tool rows carry the same
    // platform fact, inverted between the bash and pwsh twins, so exactly one
    // shell stack mounts per host. Evaluate with a platform-scoped context
    // (the `with` scope shadows the global `process`) so both outcomes pin on
    // every host.
    for (const [id, win32, linux] of [
      ['bash-sandbox', true, false],
      ['tool-bash', true, false],
      ['pwsh-sandbox', false, true],
      ['tool-pwsh', false, true],
    ] as const) {
      const row = rows.find(candidate => candidate.id === id)
      if (row === undefined) throw new Error(`base patch must mount ${id}`)
      const expression = (row.disabled as { __jsExpr?: string } | undefined)?.__jsExpr
      if (expression === undefined) throw new Error(`${id} must gate on a !!js disabled expression`)
      expect(Boolean(evaluate({ process: { platform: 'win32' } }, expression)), `${id} on win32`).toBe(win32)
      expect(Boolean(evaluate({ process: { platform: 'linux' } }, expression)), `${id} on linux`).toBe(linux)
    }
    // The platform layer folded into these rows: no separate patch file ships.
    expect(existsSync(resolve(root, 'windows.cordis.patch.yml'))).toBe(false)
  })
})
