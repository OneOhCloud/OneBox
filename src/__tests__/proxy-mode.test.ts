import { describe, expect, it } from 'vitest';
import { deriveProxyTransportMode, isProxyTransportMode } from '../utils/proxy-mode';

describe('proxy transport mode', () => {
    it.each([
        [true, true, 'tun'],
        [true, false, 'tun'],
        [true, undefined, 'tun'],
        [false, true, 'manual'],
        [undefined, true, 'manual'],
        [false, false, 'system'],
        [undefined, undefined, 'system'],
    ])(
        'derives %s/%s from the legacy booleans as %s',
        (enableTun, skipSystemProxy, expected) => {
            expect(deriveProxyTransportMode(enableTun, skipSystemProxy)).toBe(expected);
        },
    );

    it.each(['tun', 'system', 'manual'])('accepts %s as a stored mode', (mode) => {
        expect(isProxyTransportMode(mode)).toBe(true);
    });

    it.each([undefined, null, '', 'TUN', 'SystemProxy', true, 1])(
        'rejects %s as a stored mode',
        (value) => {
            expect(isProxyTransportMode(value)).toBe(false);
        },
    );
});
