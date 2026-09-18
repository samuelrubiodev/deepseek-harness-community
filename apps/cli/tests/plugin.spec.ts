import { afterEach, describe, expect, it, vi } from 'vitest'
import { runPlugin } from '../src/plugin.ts'
import { runPluginCommand } from '@deepseek-ai/dsh-plugin-manager/operations'
import { INSTALL_ANCHOR } from '../src/profile-boot.ts'

vi.mock('@deepseek-ai/dsh-plugin-manager/operations', () => ({
  runPluginCommand: vi.fn(),
}))

describe('runPlugin', () => {
  afterEach(() => {
    vi.mocked(runPluginCommand).mockReset()
    vi.restoreAllMocks()
  })

  it('forwards arguments to runPluginCommand and returns 0 on success', async () => {
    vi.mocked(runPluginCommand).mockImplementation(async (_ctx, _args, options) => {
      options.onOutput?.('sample output\n', 'stdout')
      options.onOutput?.('sample error\n', 'stderr')
      return { exitCode: 0, logPath: '/tmp/pnpm.log', output: '', truncated: false }
    })
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

    const code = await runPlugin('custom-test', ['list'])
    expect(code).toBe(0)
    expect(runPluginCommand).toHaveBeenCalledWith(
      { profile: 'custom-test', installAnchor: INSTALL_ANCHOR, cwd: process.cwd() },
      ['list'],
      expect.objectContaining({ execution: 'cli', outputBytes: 16384, lockWaitMs: 120000 }),
    )
    expect(stdoutSpy).toHaveBeenCalledWith('sample output\n')
    expect(stderrSpy).toHaveBeenCalledWith('sample error\n')
  })

  it('reports missing pnpm when exitCode is 127', async () => {
    vi.mocked(runPluginCommand).mockResolvedValue({
      exitCode: 127,
      logPath: '/tmp/pnpm.log',
      output: '',
      truncated: false,
    })
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

    const code = await runPlugin('custom-test', ['install'])
    expect(code).toBe(127)
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('pnpm was not found'))
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('diagnostics: /tmp/pnpm.log'))
  })

  it('reports git-hosted build guidance when install of git URL fails', async () => {
    vi.mocked(runPluginCommand).mockResolvedValue({
      exitCode: 1,
      logPath: '/tmp/pnpm.log',
      output: '',
      truncated: false,
    })
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

    const code = await runPlugin('custom-test', ['add', 'github:example/plugin'])
    expect(code).toBe(1)
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('diagnostics: /tmp/pnpm.log'))
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('git-hosted plugins build on install'))
  })
})
