'use client';

import { confirm } from '@tauri-apps/plugin-dialog';
import { relaunch } from '@tauri-apps/plugin-process';
import { check } from '@tauri-apps/plugin-updater';
import { useEffect, useState } from "react";
import { getStoreValue } from '../../single/store';
import { STAGE_VERSION_STORE_KEY } from '../../types/definition';
import { t, vpnServiceManager } from "../../utils/helper";

import { type Update } from '@tauri-apps/plugin-updater';

export default function UpdaterButton() {
    const [downloadComplete, setDownloadComplete] = useState(false);
    const [updateInfo, setUpdateInfo] = useState<Update | null>(null);

    const confirmInstallation = async () => {
        if (!updateInfo) return;

        const confirmed = await confirm(t("update_downloaded"), {
            title: t("update_install"),
            kind: 'info',
        });

        if (confirmed) {
            try {
                // 安装更新
                await vpnServiceManager.stop();
                setTimeout(async () => {
                    await updateInfo.install();
                    await relaunch();
                }, 2000); // 延迟2秒后重启应用

            } catch (error) {
                console.error('Installation error:', error);
            }
        }
    };

    const handleInstall = async () => {
        await confirmInstallation();
    };

    useEffect(() => {
        const checkAndDownload = async () => {
            try {
                // 获取当前阶段版本
                let stage = await getStoreValue(STAGE_VERSION_STORE_KEY, "latest");
                if (stage === "stable") {
                    stage = "latest"; // 稳定版直接使用最新版本
                }
                const checkResult = await check({
                    timeout: 5000, // 设置超时时间为10秒
                    headers: {
                        'Accept': 'application/json',
                        'stage': stage,
                    }
                });
                if (checkResult) {
                    try {
                        // 保存更新信息
                        setUpdateInfo(checkResult);
                        // 先下载更新
                        await checkResult.download((event) => {
                            // 这里可以添加下载进度的处理
                            console.log('Download progress:', event);
                        });
                        // 下载完成后设置状态
                        setDownloadComplete(true);
                    } catch (error) {
                        console.error('Download error:', error);
                    }
                }
            } catch (error) {
                console.error('Error during update:', error);
            }
        };

        checkAndDownload();
    }, []);

    if (!downloadComplete) {
        return <></>;
    }

    return (
        <button
            className="btn  btn-xs  btn-secondary"
            onClick={handleInstall}
        >
            {t("install_new_update")}
        </button>
    );
}