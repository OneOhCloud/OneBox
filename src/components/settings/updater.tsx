import { confirm, message } from '@tauri-apps/plugin-dialog';
import { exit, relaunch } from '@tauri-apps/plugin-process';
import { type Update } from '@tauri-apps/plugin-updater';
import { useEffect, useState } from "react";
import { CheckCircle, CloudArrowUpFill } from "react-bootstrap-icons";
import { t, vpnServiceManager } from "../../utils/helper";
import { SettingItem } from "./common";
import { useUpdate } from "./update-context";

// 更新安装确认处理逻辑
function useUpdateInstallation(isSimulating: boolean) {
    const confirmInstallation = async (updateInfo: Update) => {
        const confirmed = await confirm(t("update_downloaded"), {
            title: t("update_install"),
            kind: 'info',
        });

        if (confirmed) {
            try {
                if (isSimulating) {
                    await exit();
                    return;
                }
                // 安装更新
                await vpnServiceManager.stop();
                setTimeout(async () => {
                    await updateInfo.install();
                    await relaunch();
                }, 2000);

            } catch (error) {
                console.error('Installation error:', error);
                await message(t('update_install_failed'), {
                    title: t('error'),
                    kind: 'error'
                });
            }
        }
    };

    return { confirmInstallation };
}

// 更新操作处理逻辑
function useUpdateHandler() {
    const {
        updateInfo,
        downloadComplete,
        downloading,
        checkAndDownloadUpdate
    } = useUpdate();

    const [isUpdating, setIsUpdating] = useState(false);
    const [isClicked, setIsClicked] = useState(false);

    const handleUpdateClick = async (confirmInstallation: (update: Update) => Promise<void>) => {
        console.log("Button clicked, setting isClicked to true");
        setIsClicked(true);

        if (isUpdating) {
            console.log("Already updating, returning early");
            return;
        }

        setIsUpdating(true);

        try {
            // 如果已经下载完成，直接进入安装确认流程
            if (downloadComplete && updateInfo) {
                console.log("Download complete, confirming installation");
                await confirmInstallation(updateInfo);
                return;
            }

            // 如果正在下载，不做任何操作，只显示进度
            if (downloading) {
                console.log("Already downloading, showing progress only");
                return;
            }

            // 开始检查和下载更新
            console.log("Starting update check and download");
            const result = await checkAndDownloadUpdate();

            if (!result) {
                await message(
                    t('no_update_available'), {
                    title: t('update'),
                    kind: 'info',
                });
                // 如果没有更新，重置 isClicked
                console.log("No update available, resetting isClicked");
                setIsClicked(false);
            }
        } catch (error) {
            console.error('Error during update:', error);
            // 发生错误时重置 isClicked
            console.log("Error occurred, resetting isClicked");
            setIsClicked(false);
        } finally {
            setIsUpdating(false);
        }
    };

    return {
        isUpdating,
        isClicked,
        handleUpdateClick,
        setIsClicked
    };
}

// 下载进度显示组件
function DownloadProgress({
    downloadProgress,
    isVisible
}: {
    downloadProgress: number;
    isVisible: boolean;
}) {
    if (!isVisible) return null;

    return (
        <div className="animate-fadeIn">
            <div
                className="h-[2px] bg-primary rounded-2xl transition-all duration-300 ease-out"
                style={{ width: `${downloadProgress}%` }}
            />
        </div>
    );
}
// 更新按钮组件
function UpdateButton({
    isSimulating,
    updateInfo,
    downloadComplete,
    isUpdating,
    onUpdateClick,
    onInstallClick
}: {
    isSimulating: boolean;
    updateInfo: Update | null;
    downloadComplete: boolean;
    isUpdating: boolean;
    onUpdateClick: () => void;
    onInstallClick: () => void;
}) {
    const updateAvailable = !!updateInfo;

    // 如果已下载完成且用户已点击，显示安装按钮
    if (downloadComplete && updateInfo) {
        return (
            <SettingItem
                icon={<CloudArrowUpFill className="text-[#34C759]" size={22} />}
                title={t("install_new_update")}
                badge={<CheckCircle className="text-[#34C759] mr-2" size={20} />}
                onPress={onInstallClick}
            />
        );
    }

    // 默认更新按钮
    return (
        <SettingItem
            icon={<CloudArrowUpFill className="text-[#34C759]" size={22} />}
            title={isSimulating ? "模拟更新" : t("update")}
            badge={updateAvailable ? <span className="badge badge-sm bg-[#FF3B30] border-[#FF3B30] text-white mr-2">New</span> : undefined}
            onPress={onUpdateClick}
            disabled={isUpdating}
        />
    );
}

// 调试日志组件（开发环境使用）
function useDebugLogging(downloading: boolean, isClicked: boolean, downloadProgress: number, downloadComplete: boolean) {
    useEffect(() => {
        console.log("downloading 状态变化:", downloading);
    }, [downloading]);

    useEffect(() => {
        console.log("isClicked 状态变化:", isClicked);
        console.log("downloadProgress:", downloadProgress, "downloadComplete:", downloadComplete);
    }, [isClicked, downloadProgress, downloadComplete]);


}

// 主组件
export default function UpdaterItem() {
    const {
        updateInfo,
        downloadComplete,
        downloading,
        downloadProgress,
        isSimulating
    } = useUpdate();

    const { confirmInstallation } = useUpdateInstallation(isSimulating);
    const { isUpdating, isClicked, handleUpdateClick } = useUpdateHandler();

    // 调试日志
    isSimulating && useDebugLogging(downloading, isClicked, downloadProgress, downloadComplete);

    const onUpdateClick = () => handleUpdateClick(confirmInstallation);
    const onInstallClick = () => updateInfo && confirmInstallation(updateInfo);

    return (
        <>
            <UpdateButton
                updateInfo={updateInfo}
                isUpdating={isUpdating}
                isSimulating={isSimulating}
                onUpdateClick={onUpdateClick}
                onInstallClick={onInstallClick}
                downloadComplete={downloadComplete}

            />

            <DownloadProgress
                downloadProgress={downloadProgress}
                isVisible={isClicked && downloadProgress > 0 && !downloadComplete}
            />
        </>
    );
}
