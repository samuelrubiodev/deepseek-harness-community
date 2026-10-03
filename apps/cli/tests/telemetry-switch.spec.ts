import { describe, expect, it } from 'vitest'
import { resolveTelemetryPatch } from '@deepseek-ai/dsh-app-boot'

const disabledPatch = { id: 'session-telemetry-otel', disabled: true }

describe('resolveTelemetryPatch', () => {
  it('is trivially satisfied by a composition without the telemetry row', () => {
    // A custom profile need not mount telemetry: nothing exports, so the
    // switches have nothing to disable and generate no patch.
    expect(resolveTelemetryPatch('1', '1', false)).toBeUndefined()
    expect(resolveTelemetryPatch(undefined, undefined, false)).toBeUndefined()
  })

  it('denies by default when neither signal is set', () => {
    expect(resolveTelemetryPatch(undefined, undefined, true)).toEqual(disabledPatch)
    expect(resolveTelemetryPatch('', '', true)).toEqual(disabledPatch)
  })

  it('lets a non-empty DSH_TELEMETRY_ENABLED opt in', () => {
    expect(resolveTelemetryPatch(undefined, '1', true)).toBeUndefined()
    expect(resolveTelemetryPatch('', 'true', true)).toBeUndefined()
  })

  it('disables on ANY non-empty DSH_TELEMETRY_DISABLED value, and the disable beats the opt-in', () => {
    for (const value of ['1', '0', 'false', 'no']) {
      expect(resolveTelemetryPatch(value, '1', true)).toEqual(disabledPatch)
    }
  })
})
