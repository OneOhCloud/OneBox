import { type Update } from '@tauri-apps/plugin-updater';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock Tauri plugin-updater
vi.mock('@tauri-apps/plugin-updater', () => ({
    check: vi.fn(),
}));

// Mock the store module
vi.mock('../single/store', () => ({
    getStoreValue: vi.fn(),
    setStoreValue: vi.fn(),
}));

// Mock helper
vi.mock('../utils/helper', () => ({
    getSingBoxUserAgent: vi.fn().mockResolvedValue('SFM/arm64/1.0.0'),
}));

import { getStoreValue, setStoreValue } from '../single/store';
import { STAGE_VERSION_STORE_KEY } from '../types/definition';
import { downloadUpdateIfNeeded, getUpdateInterval } from '../utils/update';

const mockGetStoreValue = vi.mocked(getStoreValue);
const mockSetStoreValue = vi.mocked(setStoreValue);

// Helper: build a mock Update object
function makeUpdate(version: string, downloadImpl?: (onEvent: any) => Promise<void>): Update {
    return {
        version,
        download: vi.fn().mockImplementation(downloadImpl ?? (() => Promise.resolve())),
    } as unknown as Update;
}

beforeEach(() => {
    vi.clearAllMocks();
    mockSetStoreValue.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// 1. Stage → update interval
// ---------------------------------------------------------------------------
describe('update interval by stage', () => {
    it('dev stage: checks every 15 minutes', async () => {
        mockGetStoreValue.mockResolvedValue('dev');
        expect(await getUpdateInterval()).toBe(1000 * 60 * 15);
    });

    it('beta stage: checks every 1 hour', async () => {
        mockGetStoreValue.mockResolvedValue('beta');
        expect(await getUpdateInterval()).toBe(1000 * 60 * 60);
    });

    it('stable stage: checks every 7 days', async () => {
        mockGetStoreValue.mockResolvedValue('stable');
        expect(await getUpdateInterval()).toBe(1000 * 60 * 60 * 24 * 7);
    });

    it('reads from STAGE_VERSION_STORE_KEY', async () => {
        mockGetStoreValue.mockResolvedValue('beta');
        await getUpdateInterval();
        expect(mockGetStoreValue).toHaveBeenCalledWith(STAGE_VERSION_STORE_KEY, 'stable');
    });
});

// ---------------------------------------------------------------------------
// 2. Download behavior
// ---------------------------------------------------------------------------
describe('downloadUpdateIfNeeded', () => {
    it('always calls download() — Tauri has no cross-session state', async () => {
        const update = makeUpdate('2.0.0');
        await downloadUpdateIfNeeded(update, vi.fn());
        expect((update.download as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    });

    it('reports download progress via callback', async () => {
        const update = makeUpdate('2.0.0', async (onEvent) => {
            onEvent({ event: 'Started', data: { contentLength: 1000 } });
            onEvent({ event: 'Progress', data: { chunkLength: 500 } });
            onEvent({ event: 'Progress', data: { chunkLength: 500 } });
        });

        const progress: number[] = [];
        await downloadUpdateIfNeeded(update, (p) => progress.push(p));

        expect(progress).toEqual([50, 100]);
    });

    it('always calls download() regardless of previously seen version', async () => {
        // Tauri Update object must have download() called before install(),
        // there is no cross-session skip logic.
        const update = makeUpdate('2.0.0');
        await downloadUpdateIfNeeded(update, vi.fn());
        expect((update.download as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    });
});
