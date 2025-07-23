import { confirm, message } from '@tauri-apps/plugin-dialog';
import { relaunch } from '@tauri-apps/plugin-process';
import { check } from '@tauri-apps/plugin-updater';
import { useEffect, useState } from "react";
import { CloudArrowDown, CloudArrowUpFill } from "react-bootstrap-icons";
import { getStoreValue } from '../../single/store';
import { STAGE_VERSION_STORE_KEY } from '../../types/definition';
import { t, vpnServiceManager } from "../../utils/helper";
import { SettingItem } from "./common";

export default function UpdaterItem() {
    const [updateAvailable, setUpdateAvailable] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [downloadProgress, setDownloadProgress] = useState(0);
    const [simulateUpdate, _] = useState(false);
    const [isUpdating, setIsUpdating] = useState(false);

    const simulateUpdateProcess = async () => {
        try {
            setDownloading(true);
            // 模拟下载开始
            console.log('开始模拟下载更新...');
            // 模拟下载进度
            let progress = 0;
            const interval = setInterval(() => {
                progress += 5;
                setDownloadProgress(progress);

                if (progress >= 100) {
                    clearInterval(interval);
                    setDownloading(false);
                    console.log('模拟下载完成');
                    confirmInstallation();
                }
            }, 500);

        } catch (error) {
            console.error('模拟更新过程中出错:', error);
            setDownloading(false);
        } finally {
            setIsUpdating(false);
        }
    };

    // 确认是否安装更新
    const confirmInstallation = async () => {
        const confirmed = await confirm(t("update_downloaded"), {
            title: t("update_install"),
            kind: 'info',
        });

        if (confirmed) {
            await vpnServiceManager.stop()
            await new Promise(resolve => setTimeout(resolve, 2000));
            await relaunch();
        }
    };

    const updateApp = async () => {
        if (isUpdating) {
            return;
        }
        setIsUpdating(true);

        try {
            // 如果是模拟更新，则执行模拟流程
            if (simulateUpdate) {
                await simulateUpdateProcess();
                return;
            }

            // 获取当前阶段版本
            let stage = await getStoreValue(STAGE_VERSION_STORE_KEY, "latest");
            if (stage === "stable") {
                stage = "latest"; // 稳定版直接使用最新版本
            }

            // 真实更新流程
            const updateInfo = await check({
                timeout: 5000, // 设置超时时间为10秒
                headers: {
                    'Accept': 'application/json',
                    'stage': stage,
                }
            });

            if (updateInfo) {
                console.log(
                    `found update ${updateInfo.version} from ${updateInfo.date} with notes ${updateInfo.body}`
                );

                setDownloading(true);
                let downloaded = 0;
                let contentLength = 0;
                await updateInfo.downloadAndInstall((event) => {
                    switch (event.event) {
                        case 'Started':
                            // @ts-ignore
                            contentLength = event.data.contentLength;
                            console.log(`started downloading ${event.data.contentLength} bytes`);
                            break;
                        case 'Progress':
                            downloaded += event.data.chunkLength;
                            const progress = Math.round((downloaded / contentLength) * 100);
                            setDownloadProgress(progress);
                            console.log(`downloaded ${downloaded} from ${contentLength}`);
                            break;
                        case 'Finished':
                            setDownloading(false);
                            console.log('download finished');
                            confirmInstallation();
                            break;
                    }
                });
            } else {
                await message(
                    t('no_update_available'), {
                    title: t('update'),
                    kind: 'info',
                });
                console.log('No updates available');
            }
        } catch (error) {
            console.error('Error during update:', error);
            setDownloading(false);
        } finally {
            setIsUpdating(false);
        }
    };

    useEffect(() => {
        // 检查更新
        const checkForUpdates = async () => {
            // 如果是模拟模式，直接设置有更新可用
            if (simulateUpdate) {
                setUpdateAvailable(true);
                return;
            }

            try {
                const update = await check();
                if (update) {
                    setUpdateAvailable(true);
                }
            } catch (error) {
                console.error('Error checking for updates:', error);
            }
        };

        checkForUpdates();
    }, [simulateUpdate]); // 添加simulateUpdate作为依赖项

    return (
        <>
            <SettingItem
                icon={<CloudArrowUpFill className="text-[#34C759]" size={22} />}
                title={simulateUpdate ? "模拟更新" : t("update")}
                badge={updateAvailable ? <span className="badge badge-sm bg-[#FF3B30] border-[#FF3B30] text-white mr-2">New</span> : undefined}
                subTitle={updateAvailable ? t("update_available") : t("is_latest_version")}
                onPress={(!downloading) ? updateApp : undefined}
                disabled={downloading}
            />


            {downloading && (
                <div
                    className="flex items-center justify-between p-4 hover:bg-gray-50 active:bg-gray-100 cursor-pointer transition-colors"
                >
                    <div className="flex items-center">
                        <div className="mr-4"><CloudArrowDown size={22} /></div>
                        <span className="text-[#1C1C1E] text-xs">{t("progress")} {downloadProgress} %</span>
                    </div>
                    <div className="flex items-center">
                        <span className="loading  loading-xs loading-infinity  text-primary"></span>
                    </div>
                </div>
            )}
        </>
    )
}