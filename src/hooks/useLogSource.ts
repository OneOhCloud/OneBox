import { listen } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';
import { LogEntry } from '../components/log/types';
import { getClashApiSecret } from '../single/store';

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
                    const secret = await getClashApiSecret();
                    const response = await fetch('http://localhost:9191/logs', {
                        headers: {
                            'Authorization': `Bearer ${secret}`
                        }
                    });

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
