import { describe, expect, it } from 'vitest';
import { canRepairDns, toWlanStatus, wlanStatusLabelKey } from '../utils/wlan-status';

describe('wlan status decoding', () => {
    it.each([
        [0, 'online'],
        [1, 'captive_portal'],
        [-1, 'unreachable'],
        [-2, 'dns_failed'],
    ] as const)('decodes %i as %s', (code, status) => {
        expect(toWlanStatus(code)).toBe(status);
    });

    it('treats an unknown code as unreachable rather than online', () => {
        expect(toWlanStatus(42)).toBe('unreachable');
    });
});

describe('wlan status label', () => {
    it.each([
        ['online', 'network_normal'],
        ['dns_failed', 'network_dns_abnormal'],
        ['unreachable', 'network_abnormal'],
        ['captive_portal', 'network_abnormal'],
    ] as const)('labels %s with %s', (status, key) => {
        expect(wlanStatusLabelKey(status)).toBe(key);
    });
});

describe('dns repair availability', () => {
    it('is offered for a DNS failure on macOS', () => {
        expect(canRepairDns('dns_failed', 'macos')).toBe(true);
    });

    it.each([
        ['another failure on macOS', 'unreachable', 'macos'],
        ['a DNS failure on Windows', 'dns_failed', 'windows'],
        ['a DNS failure on Linux', 'dns_failed', 'linux'],
    ] as const)('is not offered for %s', (_label, status, osType) => {
        expect(canRepairDns(status, osType)).toBe(false);
    });
});
