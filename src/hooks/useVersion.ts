import { invoke } from '@tauri-apps/api/core';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { getClashApiSecret } from '../single/store';


export function useVersion() {
    const [version, setVersion] = useState<string>('');

    useEffect(() => {
        const fetchVersion = async () => {
            try {
                const appVersion = await invoke('get_app_version') as string;
                setVersion(appVersion);
            } catch (error) {
                console.error('Error fetching version:', error);
            }
        };

        fetchVersion();
    }, []);

    return version;
}

export function useIsRunning() {
    const { data: isRunning, mutate, isLoading } = useSWR<boolean>(`is_running`, async () => {
        const secret = await getClashApiSecret();
        return await invoke<boolean>('is_running', { secret: secret });
    }, {
        refreshInterval: 1000,
    });

    return { isRunning, mutate, isLoading };
}