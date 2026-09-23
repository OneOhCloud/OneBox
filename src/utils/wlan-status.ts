/** WLAN probe outcome, decoded from `check_captive_portal_status`. */
export type WlanStatus = 'online' | 'captive_portal' | 'dns_failed' | 'unreachable';

/** Mirrors `CaptiveProbeStatus` in src-tauri/src/commands/network.rs. */
const WLAN_STATUS_BY_CODE: Record<number, WlanStatus> = {
    [-2]: 'dns_failed',
    [-1]: 'unreachable',
    0: 'online',
    1: 'captive_portal',
};

/** An unknown code must never read as healthy. */
export function toWlanStatus(code: number): WlanStatus {
    return WLAN_STATUS_BY_CODE[code] ?? 'unreachable';
}

export function wlanStatusLabelKey(status: WlanStatus): string {
    switch (status) {
        case 'online':
            return 'network_normal';
        case 'dns_failed':
            return 'network_dns_abnormal';
        default:
            return 'network_abnormal';
    }
}

/** Only macOS ships the DNS repair (`engine_repair_system_dns`). */
export function canRepairDns(status: WlanStatus, osType: string): boolean {
    return status === 'dns_failed' && osType === 'macos';
}

/** Mirrors `DnsRepairOutcome` in src-tauri/src/engine/mod.rs. */
export type DnsRepairOutcome = 'repaired' | 'nothing_to_repair';
