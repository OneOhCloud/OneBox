'use client';

import { confirm } from '@tauri-apps/plugin-dialog';
import { relaunch } from '@tauri-apps/plugin-process';
import { check } from '@tauri-apps/plugin-updater';
import { useEffect, useState } from "react";
import { getStoreValue } from '../../single/store';
import { STAGE_VERSION_STORE_KEY } from '../../types/definition';
import { t, vpnServiceManager } from "../../utils/helper";

export default function UpdaterButton() {
    const [downloadComplete, setDownloadComplete] = useState(false);

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
                const updateInfo = await check({
                    timeout: 5000, // 设置超时时间为10秒
                    headers: {
                        'Accept': 'application/json',
                        'stage': stage,
                    }
                });
                if (updateInfo) {
                    await updateInfo.downloadAndInstall(async (event) => {
                        if (event.event === 'Finished') {
                            setDownloadComplete(true);
                        }
                    });
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