

import { fetch as httpFetch } from '@tauri-apps/plugin-http';
import { useEffect, useState } from 'react';
import { LogEntry } from '../components/log/types';
import { getClashApiSecret } from '../single/store';

const CLASH_API_BASE_URL = 'http://127.0.0.1:9191';

// plugin-http 的 reqwest 默认读取系统代理（auto_sys_proxy=true）；在“不设置系统代理”模式下，
// 若机器已有外部代理，发往 127.0.0.1:9191 的请求会被带进代理而失败（reqwest 对回环地址无隐式豁免）。
// 加一个“永远被绕过的占位代理”会让 reqwest 置 auto_sys_proxy=false（等价 Rust 侧
// build_no_redirect_client 的 .no_proxy()），从而不再读取系统代理；noProxy 再把目标豁免为直连。
//
// noProxy 必须写 IP，不能用 "*"：hyper-util 的 matcher 对能解析成 IP 的 host 只查 IP 列表，
// 而 "*" 会被归入 domain 列表，对 127.0.0.1 这类 IP 目标永不命中，请求反而打到占位代理导致
// “error sending request”。占位 URL 仅为构造 Proxy 的必填项，因目标已被 noProxy 豁免而永不被连接。
const NO_SYSTEM_PROXY = { all: { url: 'http://127.0.0.1:1', noProxy: '127.0.0.1, ::1, localhost' } } as const;

// clash API（external controller）的统一入口：注入鉴权头并强制不走任何系统代理。
export async function clashApiFetch(
    path: string,
    init: NonNullable<Parameters<typeof httpFetch>[1]> = {},
) {
    const secret = await getClashApiSecret();
    return httpFetch(`${CLASH_API_BASE_URL}${path}`, {
        ...init,
        proxy: NO_SYSTEM_PROXY,
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${secret}`,
            ...init.headers,
        },
    });
}

// 下面的流式方法沿用 webview 全局 fetch：浏览器对回环地址自动豁免代理，且 plugin-http
// 不适合 /logs、/traffic 这类无限分块流；故这里不经过 clashApiFetch。
export const ClashService = {
    async fetchLogs() {
        const secret = await getClashApiSecret();
        return fetch('http://localhost:9191/logs', {
            headers: {
                'Authorization': `Bearer ${secret}`
            }
        });
    },
    async fetchTraffic() {
        const secret = await getClashApiSecret();
        return fetch('http://localhost:9191/traffic', {
            headers: {
                'Authorization': `Bearer ${secret}`
            }
        });
    },
    async deleteConnections() {
        const secret = await getClashApiSecret();
        return fetch('http://localhost:9191/connections', {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${secret}`
            }
        });
    }
};


export function useLogSource() {
    const [logs, setLogs] = useState<LogEntry[]>([]);

    useEffect(() => {

        let readerRef: ReadableStreamDefaultReader<Uint8Array> | null = null;

        const setup = async () => {
            try {
                const response = await ClashService.fetchLogs();
                const reader = response.body?.getReader();
                if (!reader) return;

                readerRef = reader;

                const readChunk = async () => {
                    try {
                        const { value, done } = await reader.read();
                        if (done) return;

                        const text = new TextDecoder().decode(value);
                        const lines = text.split('\n').filter(line => line.trim());

                        lines.forEach(line => {
                            try {
                                const data = JSON.parse(line);
                                const newLog: LogEntry = {
                                    type: data.type,
                                    payload: data.payload,
                                    message: `[${data.type}] ${data.payload}`,
                                    timestamp: new Date().toTimeString().split(' ')[0],
                                };
                                setLogs(prev => [...prev, newLog]);
                            } catch (e) {
                                console.error('Failed to parse log:', e);
                            }
                        });

                        readChunk();
                    } catch (err) {
                        console.error('Stream reading failed:', err);
                    }
                };

                readChunk();
            } catch (error) {
                console.error('Fetch failed:', error);
            }
        };

        setup();

        return () => {
            // Cleanup function
            if (readerRef) {
                readerRef.cancel();
            }
        };

    }, []);

    const clearLogs = () => setLogs([]);

    return { logs, clearLogs };
}

export interface NetworkSpeed {
    upload: number;
    download: number;
}

export const formatNetworkSpeed = (bytes: number): string => {
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex++;
    }

    return `${value.toFixed(1)} ${units[unitIndex]}/s`;
};

export function useNetworkSpeed(enabled: boolean = true) {
    const [speed, setSpeed] = useState<NetworkSpeed>({ upload: 0, download: 0 });

    useEffect(() => {
        if (!enabled) return;

        let readerRef: ReadableStreamDefaultReader<Uint8Array> | null = null;

        const setup = async () => {
            try {
                const response = await ClashService.fetchTraffic();
                const reader = response.body?.getReader();
                if (!reader) return;

                readerRef = reader;

                const readChunk = async () => {
                    try {
                        const { value, done } = await reader.read();
                        if (done) return;

                        const text = new TextDecoder().decode(value);
                        try {
                            const data = JSON.parse(text);
                            setSpeed({
                                upload: data.up,
                                download: data.down
                            });
                        } catch (e) {
                            console.error('Failed to parse network speed data:', e);
                        }

                        readChunk();
                    } catch (err) {
                        console.error('Network speed stream reading failed:', err);
                    }
                };

                readChunk();
            } catch (error) {
                console.error('Network speed stream setup failed:', error);
            }
        };

        setup();

        return () => {
            if (readerRef) {
                readerRef.cancel();
            }
        };
    }, [enabled]);

    return speed;
}
