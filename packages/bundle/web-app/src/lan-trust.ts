/** Single-sample LAN-trust resolution for the browser-trust fence and URL display. */

import { networkInterfaces } from 'node:os'

/** The webserver schema's all-interfaces bind literal. */
export const ALL_INTERFACES_HOST = '0.0.0.0'

/** Bind-dependent Web values shared by the trust fence and URL display. */
export interface WebRuntimeValues {
  /** LAN IPv4 literals sampled once when the server binds all interfaces. */
  lanAddresses: string[]
  /** LAN literals followed by explicit invocation authorities. */
  trustedHosts: string[]
}

/**
 * Resolve one LAN-trust snapshot from the active server bind.
 * @param bindHost - the active webserver bind host.
 * @param extra - explicit `--trusted-host` values, in argument order.
 * @returns the LAN display addresses and invocation-derived fence authorities.
 */
export function resolveLanTrust(bindHost: string, extra: readonly string[]): WebRuntimeValues {
  const lanAddresses = bindHost === ALL_INTERFACES_HOST
    ? Object.values(networkInterfaces()).flat()
      .filter((iface): iface is NonNullable<typeof iface> => iface !== undefined && iface.family === 'IPv4' && !iface.internal)
      .map(iface => iface.address)
    : []
  const envTrusted = (process.env.DSH_TRUSTED_HOSTS ?? '')
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0)
  const combined = Array.from(new Set([...lanAddresses, ...envTrusted, ...extra]))
  return { lanAddresses, trustedHosts: combined }
}
