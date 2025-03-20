import { invoke } from '@tauri-apps/api/core';

import { useEffect, useState } from 'react';


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