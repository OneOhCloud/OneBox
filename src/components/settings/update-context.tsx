import { type Update } from '@tauri-apps/plugin-updater';
import { createContext, ReactNode, useContext, useEffect, useRef, useState } from 'react';
import {
    checkUpdate,
    downloadUpdateIfNeeded,
    getLastUpdateCheckTime,
    getUpdateInterval,
    setLastUpdateCheckTime,
} from '../../utils/update';

interface UpdateContextType {
    updateInfo: Update | null;
    downloading: boolean;
    isSimulating: boolean;
    lastCheckTime: number | null;
    downloadProgress: number;
    downloadComplete: boolean;
    checkAndDownloadUpdate: () => Promise<Update | null>;
    // Call after switching update channel. Reads the new channel's interval and
    // the persisted last-check timestamp; triggers an immediate check only if
    // the interval has elapsed.
    triggerImmediateCheck: () => Promise<void>;
}

const UpdateContext = createContext<UpdateContextType | undefined>(undefined);

export function UpdateProvider({ children }: { children: ReactNode }) {
    const [downloadComplete, setDownloadComplete] = useState(false);
    const [updateInfo, setUpdateInfo] = useState<Update | null>(null);
    const [downloading, setDownloading] = useState(false);
    const [downloadProgress, setDownloadProgress] = useState(0);
    const [lastCheckTime, setLastCheckTime] = useState<number | null>(null);
    const [isSimulating] = useState(false); // 设置为 true 可以进行模拟测试

    const checkingRef = useRef(false);
    // Refs mirror state so async closures always read current values,
    // avoiding stale captures in setTimeout callbacks.
    const downloadingRef = useRef(false);
    const downloadCompleteRef = useRef(false);

    const setDownloadingSync = (v: boolean) => {
        downloadingRef.current = v;
        setDownloading(v);
    };
    const setDownloadCompleteSync = (v: boolean) => {
        downloadCompleteRef.current = v;
        setDownloadComplete(v);
    };

    const checkAndDownloadUpdate = async () => {
        if (checkingRef.current) {
            console.log('Already checking for updates...');
            return updateInfo;
        }

        if (downloadCompleteRef.current) {
            console.log('Update already downloaded');
            return updateInfo;
        }

        if (downloadingRef.current) {
            console.log('Update is downloading...');
            return updateInfo;
        }

        checkingRef.current = true;
        console.log('Checking for updates...');

        try {
            if (isSimulating) {
                // 模拟更新检查和下载过程
                setDownloadingSync(true);
                console.log("开始 mock 下载，已设置 downloading 为 true");
                const mockUpdate = {
                    version: '2.0.0',
                    currentVersion: '1.0.0',
                    available: true,
                    pending: false,
                    downloaded: false,
                    shouldUpdate: true,
                    rawJson: { version: '2.0.0' } as Record<string, unknown>,
                    install: async () => { console.log('模拟安装更新'); },
                    download: async (onEvent?: (event: any) => void) => {
                        if (onEvent) {
                            onEvent({ event: 'Started', data: { contentLength: 1000000 } });
                        }
                        console.log('模拟下载更新开始');
                    }
                } as unknown as Update;
                setUpdateInfo(mockUpdate);
                let progress = 0;
                const simulateDownload = setInterval(() => {
                    progress += 1;
                    setDownloadProgress(progress);
                    if (progress >= 100) {
                        clearInterval(simulateDownload);
                        setDownloadCompleteSync(true);
                        setDownloadingSync(false);
                    }
                }, 100);

                return mockUpdate;
            } else {
                const checkResult = await checkUpdate();
                if (checkResult) {
                    setUpdateInfo(checkResult);
                    setDownloadingSync(true);

                    try {
                        await downloadUpdateIfNeeded(checkResult, setDownloadProgress);
                        setDownloadCompleteSync(true);
                        return checkResult;
                    } catch (error) {
                        console.error('Download error:', error);
                        throw error;
                    } finally {
                        setDownloadingSync(false);
                    }
                }
            }

            return null;
        } catch (error) {
            console.error('Error during update:', error);
            setDownloadingSync(false);
            return null;
        } finally {
            checkingRef.current = false;
            const now = Date.now();
            setLastCheckTime(now);
            await setLastUpdateCheckTime(now);
        }
    };

    // Called after the user switches update channel. Reads the new channel's
    // interval and the persisted last-check timestamp. If the interval has
    // elapsed, resets download state and triggers an immediate check.
    const triggerImmediateCheck = async () => {
        const [lastCheck, interval] = await Promise.all([
            getLastUpdateCheckTime(),
            getUpdateInterval(), // reads the newly saved stage from store
        ]);
        if (Date.now() - lastCheck >= interval) {
            setDownloadCompleteSync(false);
            setDownloadingSync(false);
            setUpdateInfo(null);
            setDownloadProgress(0);
            await checkAndDownloadUpdate();
        }
    };

    useEffect(() => {
        let cancelled = false;
        let timeoutId: ReturnType<typeof setTimeout>;

        // Poll every minute. Each tick re-reads lastCheckTime and the current
        // channel's interval from the store, so channel switches are picked up
        // automatically without needing to reschedule timers.
        const POLL_INTERVAL_MS = 60 * 1000;

        const poll = async () => {
            if (cancelled) return;

            if (!downloadingRef.current && !downloadCompleteRef.current) {
                const [lastCheck, interval] = await Promise.all([
                    getLastUpdateCheckTime(),
                    getUpdateInterval(),
                ]);

                if (lastCheck === 0) {
                    // No previous check recorded — first run ever.
                    await checkAndDownloadUpdate();
                } else {
                    const elapsed = Date.now() - lastCheck;
                    if (elapsed >= interval) {
                        await checkAndDownloadUpdate();
                    }
                }
            }

            if (!cancelled) {
                timeoutId = setTimeout(poll, POLL_INTERVAL_MS);
            }
        };

        // Restore persisted last-check time for UI display, then start polling.
        getLastUpdateCheckTime().then((lastCheck) => {
            if (!cancelled && lastCheck > 0) {
                setLastCheckTime(lastCheck);
            }
        });

        poll();

        return () => {
            cancelled = true;
            clearTimeout(timeoutId);
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <UpdateContext.Provider value={{
            updateInfo,
            downloadComplete,
            checkAndDownloadUpdate,
            triggerImmediateCheck,
            downloading,
            downloadProgress,
            lastCheckTime,
            isSimulating
        }}>
            {children}
        </UpdateContext.Provider>
    );
}

export function useUpdate() {
    const context = useContext(UpdateContext);
    if (context === undefined) {
        throw new Error('useUpdate must be used within an UpdateProvider');
    }
    return context;
}
