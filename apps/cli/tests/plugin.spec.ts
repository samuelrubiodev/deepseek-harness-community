import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runPlugin } from '../src/plugin.ts'

vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawnSync: vi.fn(),
}))

describe('runPlugin', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    vi.mocked(spawnSync).mockReset()
    process.env = { ...originalEnv }
  })

  it('initializes profile with packageManager and executes pnpm with download prompt disabled', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-plugin-test-'))
    process.env.DSH_HOME = home

    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      output: [],
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
      pid: 1234,
      signal: null,
    })

    const code = runPlugin('custom-test', ['list'])
    expect(code).toBe(0)
    expect(vi.mocked(spawnSync)).toHaveBeenCalledTimes(1)
    const [command, args, options] = vi.mocked(spawnSync).mock.calls[0]!
    expect(command).toBe('pnpm')
    expect(args).toEqual(['list'])
    expect(options?.env?.COREPACK_ENABLE_DOWNLOAD_PROMPT).toBe('0')

    const manifestPath = join(home, 'profiles', 'custom-test', 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { packageManager?: string }
    expect(manifest.packageManager).toBe('pnpm@11.7.0')
  })

  it('backfills packageManager on existing profile manifest before running pnpm', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-plugin-test-'))
    process.env.DSH_HOME = home

    const profileDir = join(home, 'profiles', 'legacy-test')
    const manifestPath = join(profileDir, 'package.json')
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(manifestPath, JSON.stringify({ name: 'legacy-profile', dependencies: {} }))

    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      output: [],
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
      pid: 1234,
      signal: null,
    })

    const code = runPlugin('legacy-test', ['list'])
    expect(code).toBe(0)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { packageManager?: string }
    expect(manifest.packageManager).toBe('pnpm@11.7.0')
  })
})
