import { describe, expect, it } from 'vitest';
import { AutoConnectGate, shouldAutoConnect } from '../utils/auto-connect';

const open: AutoConnectGate = {
    enabled: true,
    hasConfig: true,
    engineIdle: true,
    deepLinkChecked: true,
    deepLinkApplyPending: false,
};

describe('auto connect gate', () => {
    it('fires when every condition is met', () => {
        expect(shouldAutoConnect(open)).toBe(true);
    });

    it.each([
        ['the setting is off', { enabled: false }],
        ['there is no config to connect with', { hasConfig: false }],
        ['the engine is already busy', { engineIdle: false }],
        ['the pending deep link has not been resolved yet', { deepLinkChecked: false }],
        ['a deep-link apply owns the engine', { deepLinkApplyPending: true }],
    ])('does not fire when %s', (_label, override) => {
        expect(shouldAutoConnect({ ...open, ...override })).toBe(false);
    });
});
