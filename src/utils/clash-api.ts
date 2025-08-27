

import { listen } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';
import { LogEntry } from '../components/log/types';
import { getClashApiSecret } from '../single/store';

// 统一封装 fetch 调用
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

export type LogSourceType = 'tauri' | 'api';

export function useLogSource(logSource: LogSourceType) {
    const [logs, setLogs] = useState<LogEntry[]>([]);

    useEffect(() => {
        if (logSource === 'tauri') {
            const unlisten = listen('core_backend', (event) => {
                const message = event.payload as string;
                const newLog: LogEntry = {
                    message,
                    timestamp: new Date().toTimeString().split(' ')[0],
                };
                setLogs(prev => [...prev, newLog]);
            });

            return () => {
                unlisten.then(fn => fn());
            };
        } else {
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
        }
    }, [logSource]);

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
