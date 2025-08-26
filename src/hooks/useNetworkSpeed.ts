import { useEffect, useState } from 'react';
import { getClashApiSecret } from '../single/store';

export interface NetworkSpeed {
    upload: number;
    download: number;
}

export const formatNetworkSpeed = (bits: number): string => {
    const units = ['B', 'KB', 'MB', 'GB'];
    const bytes = bits / 8; // 转换为字节
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
                const secret = await getClashApiSecret();
                const response = await fetch('http://localhost:9191/traffic', {
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
