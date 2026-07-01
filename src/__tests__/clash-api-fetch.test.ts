import { beforeEach, describe, expect, it, vi } from 'vitest';

// Capture every call the wrapper makes to the plugin-http fetch.
const httpFetchMock = vi.fn();
vi.mock('@tauri-apps/plugin-http', () => ({
    fetch: (...args: unknown[]) => httpFetchMock(...args),
}));

vi.mock('../single/store', () => ({
    getClashApiSecret: vi.fn(),
}));

import { getClashApiSecret } from '../single/store';
import { clashApiFetch } from '../utils/clash-api';

const mockSecret = vi.mocked(getClashApiSecret);

// Read the options object passed to the plugin fetch on its most recent call.
function lastCall(): [string, any] {
    return httpFetchMock.mock.calls[httpFetchMock.mock.calls.length - 1] as [string, any];
}

beforeEach(() => {
    vi.clearAllMocks();
    httpFetchMock.mockResolvedValue({ ok: true });
    mockSecret.mockResolvedValue('test-secret');
});

describe('clashApiFetch', () => {
    it('targets the clash API base URL and injects auth + the no-proxy option', async () => {
        await clashApiFetch('/proxies');

        expect(httpFetchMock).toHaveBeenCalledTimes(1);
        const [url, opts] = lastCall();
        expect(url).toBe('http://127.0.0.1:9191/proxies');
        // The whole point: force reqwest off the system proxy for every host.
        expect(opts.proxy).toEqual({ all: { url: 'http://127.0.0.1:1', noProxy: '127.0.0.1, ::1, localhost' } });
        expect(opts.headers.Authorization).toBe('Bearer test-secret');
        expect(opts.headers.Accept).toBe('application/json');
        expect(opts.headers['Content-Type']).toBe('application/json');
    });

    it('merges caller init (method/body) and lets caller headers override defaults', async () => {
        await clashApiFetch('/proxies/ExitGateway', {
            method: 'PUT',
            body: JSON.stringify({ name: 'JP-01' }),
            headers: { 'X-Test': '1', Accept: 'text/plain' },
        });

        const [url, opts] = lastCall();
        expect(url).toBe('http://127.0.0.1:9191/proxies/ExitGateway');
        expect(opts.method).toBe('PUT');
        expect(opts.body).toBe('{"name":"JP-01"}');
        expect(opts.headers['X-Test']).toBe('1');
        expect(opts.headers.Accept).toBe('text/plain'); // caller override wins
        expect(opts.headers.Authorization).toBe('Bearer test-secret'); // still injected
    });

    it('never lets a caller-supplied proxy override the no-proxy policy', async () => {
        await clashApiFetch('/proxies', {
            proxy: { all: { url: 'http://10.0.0.1:8080' } },
        });

        const [, opts] = lastCall();
        expect(opts.proxy).toEqual({ all: { url: 'http://127.0.0.1:1', noProxy: '127.0.0.1, ::1, localhost' } });
    });

    it('returns whatever the plugin fetch resolves to', async () => {
        const sentinel = { ok: true, status: 204 };
        httpFetchMock.mockResolvedValueOnce(sentinel);

        await expect(clashApiFetch('/connections')).resolves.toBe(sentinel);
    });
});
