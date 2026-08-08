import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STAGE_VERSION_STORE_KEY } from '../types/definition';

vi.mock('@tauri-apps/api/path', () => ({
    appConfigDir: vi.fn().mockResolvedValue('/config'),
    join: vi.fn().mockImplementation((...parts: string[]) => Promise.resolve(parts.join('/'))),
}));

vi.mock('../action/db', () => ({
    getSubscriptionConfig: vi.fn().mockResolvedValue({ outbounds: [] }),
}));

vi.mock('../single/store', () => ({
    getAllowLan: vi.fn().mockResolvedValue(false),
    getClashApiSecret: vi.fn(),
    getCustomRuleSet: vi.fn(),
    getStoreValue: vi.fn(),
    isBypassRouterEnabled: vi.fn().mockResolvedValue(false),
    setStoreValue: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../config/merger/helper', () => ({
    configureMixedInbound: vi.fn().mockResolvedValue(undefined),
    configureTunInbound: vi.fn().mockResolvedValue(undefined),
    updateDHCPSettings2Config: vi.fn().mockResolvedValue(undefined),
    updateVPNServerConfigFromDB: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../config/templates', () => ({
    getBuiltInTemplate: vi.fn(),
}));

import { updateVPNServerConfigFromDB } from '../config/merger/helper';
import { setGlobalMixedConfig } from '../config/merger/main';
import { getClashApiSecret, getStoreValue } from '../single/store';

const mockGetClashApiSecret = vi.mocked(getClashApiSecret);
const mockGetStoreValue = vi.mocked(getStoreValue);
const mockWriteConfig = vi.mocked(updateVPNServerConfigFromDB);

beforeEach(() => {
    vi.clearAllMocks();
    mockGetStoreValue.mockImplementation((key: string) => {
        if (key === STAGE_VERSION_STORE_KEY) return Promise.resolve('dev');
        return Promise.resolve(JSON.stringify({ log: {}, experimental: {} }));
    });
});

describe('config merger', () => {
    it('waits for the Clash secret and writes the 1.14 cache schema', async () => {
        let resolveSecret!: (secret: string) => void;
        mockGetClashApiSecret.mockReturnValue(new Promise((resolve) => {
            resolveSecret = resolve;
        }));

        const mergePromise = setGlobalMixedConfig('subscription');
        await vi.waitFor(() => expect(mockGetClashApiSecret).toHaveBeenCalledOnce());
        expect(mockWriteConfig).not.toHaveBeenCalled();

        resolveSecret('secret');
        await mergePromise;

        const mergedConfig = mockWriteConfig.mock.calls[0][2];
        expect(mergedConfig.experimental.clash_api.secret).toBe('secret');
        expect(mergedConfig.experimental.cache_file).toMatchObject({
            enabled: true,
            store_fakeip: true,
            store_dns: true,
            path: '/config/mixed-cache-global-v2.db',
        });
        expect(mergedConfig.experimental.cache_file).not.toHaveProperty('store_rdrc');
    });
});
