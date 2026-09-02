import type { ProxyTransportMode } from '../types/definition';

const PROXY_TRANSPORT_MODES: readonly ProxyTransportMode[] = ['tun', 'system', 'manual'];

export function isProxyTransportMode(value: unknown): value is ProxyTransportMode {
    return typeof value === 'string' && (PROXY_TRANSPORT_MODES as readonly string[]).includes(value);
}

/**
 * Derive the transport mode from the boolean pair that predates
 * `proxy_mode_key` (`enable_tun_key` + `skip_system_proxy_key`).
 *
 * The precedence mirrors the runtime derivation the start path used before the
 * enum existed, so an upgrading install keeps the mode it was already running.
 */
export function deriveProxyTransportMode(
    enableTun: unknown,
    skipSystemProxy: unknown,
): ProxyTransportMode {
    if (Boolean(enableTun)) return 'tun';
    if (Boolean(skipSystemProxy)) return 'manual';
    return 'system';
}
