import { type Update } from '@tauri-apps/plugin-updater';
import { createContext, ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { checkUpdate } from '../../utils/update';

interface UpdateContextType {
    updateInfo: Update | null;
    downloading: boolean;
    isSimulating: boolean;
    lastCheckTime: number | null;
    downloadProgress: number;
    downloadComplete: boolean;
    checkAndDownloadUpdate: () => Promise<Update | null>;

}

const UPDATE_CHECK_INTERVAL = 1000 * 60 * 60; // 每小时检查一次
const UpdateContext = createContext<UpdateContextType | undefined>(undefined);

export function UpdateProvider({ children }: { children: ReactNode }) {
    const [downloadComplete, setDownloadComplete] = useState(false);
    const [updateInfo, setUpdateInfo] = useState<Update | null>(null);
    const [downloading, setDownloading] = useState(false);
    const [downloadProgress, setDownloadProgress] = useState(0);
    const [lastCheckTime, setLastCheckTime] = useState<number | null>(null);
    const [isSimulating] = useState(false); // 设置为 true 可以进行模拟测试
    const checkingRef = useRef(false);

    const checkAndDownloadUpdate = async () => {
        // 防止重复检查
        if (checkingRef.current) {
            console.log('Already checking for updates...');
            return updateInfo;
        }

        if (downloadComplete) {
            console.log('Update already downloaded');
            return updateInfo;
        }

        if (downloading) {
            console.log('Update is downloading...');
            return updateInfo;
        }

        checkingRef.current = true;
        console.log('Checking for updates...');

        try {
            if (isSimulating) {
                // 模拟更新检查和下载过程
                // 创建模拟更新对象
                setDownloading(true);
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
                            onEvent({
                                event: 'Started',
                                data: { contentLength: 1000000 }
                            });
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
                        setDownloadComplete(true);
                        setDownloading(false);
                    }
                }, 100);

                return mockUpdate;
            } else {
                // 真实更新检查和下载过程
                const checkResult = await checkUpdate();
                if (checkResult) {
                    setUpdateInfo(checkResult);
                    setDownloading(true);
                    let downloaded = 0;
                    let contentLength = 0;

                    try {
                        await checkResult.download((event) => {
                            switch (event.event) {
                                case 'Started':
                                    contentLength = event.data.contentLength || 0;
                                    break;
                                case 'Progress':
                                    downloaded += event.data.chunkLength;
                                    const progress = Math.round((downloaded / contentLength) * 100);
                                    setDownloadProgress(progress);
                                    break;
                                case 'Finished':
                                    console.log('Download finished');
                                    break;
                            }
                        });

                        setDownloadComplete(true);
                        return checkResult;
                    } catch (error) {
                        console.error('Download error:', error);
                        throw error;
                    } finally {
                        setDownloading(false);
                    }
                }
            }


            return null;
        } catch (error) {
            console.error('Error during update:', error);
            setDownloading(false);
            return null;
        } finally {
            checkingRef.current = false;
            setLastCheckTime(Date.now());
        }
    };

    useEffect(() => {
        // 初始检查
        const initialCheck = async () => {
            await checkAndDownloadUpdate();
        };
        initialCheck();

        // 设置定期检查
        const interval = setInterval(() => {
            if (!downloading && !downloadComplete) {
                checkAndDownloadUpdate();
            }
        }, UPDATE_CHECK_INTERVAL);

        return () => clearInterval(interval);
    }, []); // 移除依赖项，避免无限循环

    return (
        <UpdateContext.Provider value={{
            updateInfo,
            downloadComplete,
            checkAndDownloadUpdate,
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
