/**
 * Fork-owned anti-sync guard for the shipped privacy defaults.
 *
 * Every row covered here is default-denied telemetry or request metadata.
 * This spec reads the shipped bundle files and exists so that a merge
 * conflict resolved in favor of upstream fails loudly here instead of
 * silently re-enabling collection. Row expressions are evaluated against a
 * stubbed environment so a harmless reformat does not fail the guard; where
 * the expression text itself is checked, only stable substrings (variable
 * names, `DISABLED`) are asserted.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { evaluate } from '@deepseek-ai/cordis-plugin-loader'

/** One shipped row's privacy-relevant shape. */
interface ShippedRow {
  id?: string
  config?: Record<string, unknown>
  disabled?: unknown
}

/** Parse one shipped bundle patch file exactly as the Loader would. */
function shippedRows(relative: string): ShippedRow[] {
  const parsed = yaml.load(
    readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8'),
    { schema: entryListSchema },
  )
  if (!Array.isArray(parsed)) throw new Error(`${relative}: patch file must parse to a patch list`)
  return parsed.flatMap(patch =>
    typeof patch === 'object' && patch !== null ? (patch as { insert?: ShippedRow[] }).insert ?? [] : [],
  )
}

/** Locate one row; the failure names the file and row id that a sync dropped. */
function shippedRow(rows: ShippedRow[], file: string, id: string): ShippedRow {
  const row = rows.find(candidate => candidate.id === id)
  if (row === undefined) {
    throw new Error(`${file}: row '${id}' is absent; the fork's default-deny privacy composition was dropped by a sync`)
  }
  return row
}

/** The `!!js` expression text of one config property, with an actionable failure. */
function configExpression(row: ShippedRow, file: string, id: string, property: string): string {
  const value = row.config?.[property] as { __jsExpr?: string } | undefined
  if (value?.__jsExpr === undefined) {
    throw new Error(`${file}: row '${id}' config.${property} lost its !!js expression; the privacy default may have been reverted`)
  }
  return value.__jsExpr
}

/** The `!!js` expression text of one nested config property, with an actionable failure. */
function nestedConfigExpression(row: ShippedRow, file: string, id: string, path: readonly string[]): string {
  let value: unknown = row.config
  for (const segment of path) {
    value = (value as Record<string, unknown> | undefined)?.[segment]
  }
  const expression = (value as { __jsExpr?: string } | undefined)?.__jsExpr
  if (expression === undefined) {
    throw new Error(`${file}: row '${id}' config.${path.join('.')} lost its !!js expression; the privacy default may have been reverted`)
  }
  return expression
}

/** The `!!js` expression text of the row's disabled flag, with an actionable failure. */
function disabledExpression(row: ShippedRow, file: string, id: string): string {
  const value = row.disabled as { __jsExpr?: string } | undefined
  if (value?.__jsExpr === undefined) {
    throw new Error(`${file}: row '${id}' disabled lost its !!js expression; the privacy default may have been reverted`)
  }
  return value.__jsExpr
}

const baseRows = shippedRows('../cordis.patch.yml')
const webAppRows = shippedRows('../../web-app/cordis.patch.yml')
const sdkMinimalRows = shippedRows('../../sdk-minimal/cordis.patch.yml')
const BASE_FILE = 'packages/bundle/base/cordis.patch.yml'
const WEB_APP_FILE = 'packages/bundle/web-app/cordis.patch.yml'
const SDK_MINIMAL_FILE = 'packages/bundle/sdk-minimal/cordis.patch.yml'

/** Evaluate a mode expression against a stubbed environment. */
function evaluateMode(env: Record<string, string | undefined>, expression: string): unknown {
  return evaluate({ process: { env } }, expression)
}

/** Evaluate an enabled expression against a stubbed environment. */
function evaluateEnabled(env: Record<string, string | undefined>, expression: string): boolean {
  return Boolean(evaluate({ process: { env } }, expression))
}

/** Evaluate a disabled expression against a stubbed environment and profile context. */
function evaluateDisabled(env: Record<string, string | undefined>, expression: string, profile = 'desktop'): boolean {
  return Boolean(evaluate({ ctx: { get: () => ({ name: profile }) }, process: { env } }, expression))
}

describe('shipped privacy defaults', () => {
  it('keeps the base session telemetry row disabled by default, disable-wins, and collector-free', () => {
    const row = shippedRow(baseRows, BASE_FILE, 'session-telemetry-otel')
    const mode = configExpression(row, BASE_FILE, 'session-telemetry-otel', 'mode')
    expect(evaluateMode({}, mode), `${BASE_FILE}: session-telemetry-otel config.mode must resolve to DISABLED with no telemetry environment set`).toBe('DISABLED')
    expect(evaluateMode({ DSH_TELEMETRY_DISABLED: '1' }, mode), `${BASE_FILE}: session-telemetry-otel config.mode must force DISABLED when DSH_TELEMETRY_DISABLED is non-empty`).toBe('DISABLED')
    expect(evaluateMode({ DSH_TELEMETRY_DISABLED: '1', DSH_TELEMETRY_MODE: 'FEEDBACK_ONLY' }, mode), `${BASE_FILE}: session-telemetry-otel config.mode must keep DISABLED when DSH_TELEMETRY_DISABLED overrides an explicit mode`).toBe('DISABLED')
    expect(evaluateMode({ DSH_TELEMETRY_MODE: 'FEEDBACK_ONLY' }, mode), `${BASE_FILE}: session-telemetry-otel config.mode must honor an explicit DSH_TELEMETRY_MODE opt-in`).toBe('FEEDBACK_ONLY')
    const url = nestedConfigExpression(row, BASE_FILE, 'session-telemetry-otel', ['exporter', 'url'])
    expect(url, `${BASE_FILE}: session-telemetry-otel config.exporter.url must read the DSH_TELEMETRY_OTLP_URL opt-in environment`).toContain('DSH_TELEMETRY_OTLP_URL')
    expect(url, `${BASE_FILE}: session-telemetry-otel config.exporter.url must bake no fallback (no ?? operator)`).not.toContain('??')
    expect(url, `${BASE_FILE}: session-telemetry-otel config.exporter.url must bake no collector URL`).not.toContain('http')
    const endpoint = nestedConfigExpression(shippedRow(webAppRows, WEB_APP_FILE, 'desktop-product-telemetry'),
      WEB_APP_FILE, 'desktop-product-telemetry', ['endpoint'])
    expect(endpoint, `${WEB_APP_FILE}: desktop-product-telemetry config.endpoint must read the DSH_PRODUCT_ANALYTICS_OTLP_URL opt-in environment`).toContain('DSH_PRODUCT_ANALYTICS_OTLP_URL')
    expect(endpoint, `${WEB_APP_FILE}: desktop-product-telemetry config.endpoint must bake no fallback (no ?? operator)`).not.toContain('??')
    expect(endpoint, `${WEB_APP_FILE}: desktop-product-telemetry config.endpoint must bake no collector URL`).not.toContain('http')
  })

  it.each([
    ['desktop-product-telemetry'],
    ['product-analytics'],
  ])('keeps %s denied unless opted in, with disable-wins', (id) => {
    const row = shippedRow(webAppRows, WEB_APP_FILE, id)
    const disabled = disabledExpression(row, WEB_APP_FILE, id)
    expect(evaluateDisabled({}, disabled), `${WEB_APP_FILE}: ${id} disabled must deny when DSH_TELEMETRY_ENABLED is unset`).toBe(true)
    expect(evaluateDisabled({ DSH_TELEMETRY_ENABLED: '1' }, disabled), `${WEB_APP_FILE}: ${id} disabled must allow the desktop profile when only DSH_TELEMETRY_ENABLED is set`).toBe(false)
    expect(evaluateDisabled({ DSH_TELEMETRY_ENABLED: '1', DSH_TELEMETRY_DISABLED: '1' }, disabled), `${WEB_APP_FILE}: ${id} disabled must deny when DSH_TELEMETRY_DISABLED is non-empty`).toBe(true)
    expect(evaluateDisabled({ DSH_TELEMETRY_ENABLED: '', DSH_TELEMETRY_DISABLED: '' }, disabled), `${WEB_APP_FILE}: ${id} disabled must deny on empty values`).toBe(true)
    expect(evaluateDisabled({ DSH_TELEMETRY_ENABLED: '1' }, disabled, 'web'), `${WEB_APP_FILE}: ${id} disabled must deny the non-desktop profile even when opted in`).toBe(true)
    if (id === 'product-analytics') {
      expect(row.config?.['enabled'], `${WEB_APP_FILE}: product-analytics config.enabled must stay false so the plugin default denies too`).toBe(false)
    }
  })

  it.each([
    ['session-log-deepseek', 'DSH_SESSION_LOG_UPLOAD'],
    ['plugin-package-inventory-deepseek', 'DSH_PLUGIN_INVENTORY_UPLOAD'],
  ])('keeps %s denied unless its upload variable is set, with disable-wins', (id, optIn) => {
    for (const [file, rows] of [[BASE_FILE, baseRows], [SDK_MINIMAL_FILE, sdkMinimalRows]] as const) {
      const row = shippedRow(rows, file, id)
      const enabled = configExpression(row, file, id, 'enabled')
      expect(evaluateEnabled({}, enabled), `${file}: ${id} config.enabled must deny when ${optIn} is unset`).toBe(false)
      expect(evaluateEnabled({ [optIn]: '1' }, enabled), `${file}: ${id} config.enabled must allow the ${optIn} opt-in`).toBe(true)
      expect(evaluateEnabled({ [optIn]: '1', DSH_TELEMETRY_DISABLED: '1' }, enabled), `${file}: ${id} config.enabled must deny when DSH_TELEMETRY_DISABLED is non-empty`).toBe(false)
      expect(evaluateEnabled({ [optIn]: '', DSH_TELEMETRY_DISABLED: '' }, enabled), `${file}: ${id} config.enabled must deny on empty values`).toBe(false)
      expect(evaluateEnabled({ DSH_TELEMETRY_DISABLED: '0' }, enabled), `${file}: ${id} config.enabled must deny when only the disable switch is set`).toBe(false)
    }
  })

  it('bakes no collector host into any shipped bundle file', () => {
    // Scoped to the known vendor host rather than every URL: a docs link or an
    // unrelated row must not fail a privacy guard, or the tripwire gets ignored.
    // The per-row assertions above already pin that each endpoint reads its
    // opt-in environment variable instead of a literal.
    for (const [file, relative] of [
      [BASE_FILE, '../cordis.patch.yml'],
      [WEB_APP_FILE, '../../web-app/cordis.patch.yml'],
      [SDK_MINIMAL_FILE, '../../sdk-minimal/cordis.patch.yml'],
    ] as const) {
      const raw = readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
      expect(raw, `${file} must bake no vendor collector host`).not.toContain('deepseeksvc')
    }
  })
})
