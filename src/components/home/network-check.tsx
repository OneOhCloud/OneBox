import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm } from '@tauri-apps/plugin-dialog';
import { motion } from "framer-motion";
import { useCallback, useState } from "react";
import { Globe, Icon, Reception4 } from "react-bootstrap-icons";
import useSWR from "swr";
import { t } from "../../utils/helper";

type NetworkStatusProps = {
    isOk: boolean;
    icon: Icon;
    tip: string;
};

type NetworkCheckProps = {
    isRunning: boolean;
};

const LoadingStatus = ({ icon: Icon = Globe }) => (
    <motion.div
        className="tooltip tooltip-left"
        data-tip={t("loading")}

    >
        <Icon className="size-4 text-gray-500 " />
    </motion.div>
);

const NetworkStatus = ({ isOk, icon: Icon, tip }: NetworkStatusProps) => (
    <div
        className="tooltip tooltip-left"
        data-tip={`${tip}:${isOk ? t("network_normal") : t("network_abnormal")}`}
    >
        <Icon className={`size-4 ${isOk ? 'text-gray-500' : 'text-red-500'} transition-colors duration-300`} />
    </div>
);


type NetworkResponse = {
    status: boolean | string;
    needsLogin?: boolean;
    loginUrl?: string;
};

function useNetworkCheck(key: string, checkFn: () => Promise<NetworkResponse>, interval: number) {
    const [shouldRefresh, setShouldRefresh] = useState(true);
    const [confirmShown, setConfirmShown] = useState(false);

    const handleNetworkCheck = useCallback(async () => {
        if (!shouldRefresh) {
            return { status: false };
        }

        try {
            const response = await checkFn();

            if (response.needsLogin && !confirmShown) {
                setShouldRefresh(false);
                setConfirmShown(true);

                const answer = await confirm(t("network_need_login"), {
                    title: t("network_need_login_title"),
                    kind: 'warning',
                });

                if (answer && response.loginUrl) {
                    setConfirmShown(false);
                    await invoke('open_browser', {
                        app: getCurrentWindow(),
                        url: response.loginUrl
                    });
                }

                // 延迟恢复检查
                setTimeout(() => {
                    setShouldRefresh(true);
                    setConfirmShown(false);
                }, 15000);
            }

            return response;
        } catch (error) {
            console.error(`Network check failed: ${error}`);
            return { status: false };
        }
    }, [shouldRefresh, confirmShown, checkFn]);

    return useSWR(key, handleNetworkCheck, {
        refreshInterval: shouldRefresh ? interval : 0,
        errorRetryCount: 3
    });
}

export function AppleNetworkStatus({ isRunning }: NetworkCheckProps) {
    const checkAppleNetwork = useCallback(async () => {
        const res = await invoke<string>('ping_apple_captive');
        return {
            status: res === "true",
            needsLogin: res.startsWith("http"),
            loginUrl: res.startsWith("http") ? res : undefined
        };
    }, []);

    const { data, isLoading, error } = useNetworkCheck(
        `apple-network-${isRunning}`,
        checkAppleNetwork,
        1000
    );

    if (isLoading) return <LoadingStatus icon={Reception4} />;
    if (error || !data) {
        return <NetworkStatus
            isOk={false}
            icon={Reception4}
            tip={t("normal_network")}
        />;
    }

    return <NetworkStatus
        isOk={Boolean(data.status)}
        icon={Reception4}
        tip={t("normal_network")}
    />;
}

export function GoogleNetworkStatus({ isRunning }: NetworkCheckProps) {
    const { data, isLoading, error } = useSWR(
        `swr-google-${isRunning}`,
        async () => {
            if (!isRunning) return false;
            return invoke<boolean>('ping_google');
        },
        { refreshInterval: 2000 }
    );

    if (!isRunning) return null;
    if (isLoading) return <LoadingStatus />;
    if (error || data === null || data === undefined) {
        return <NetworkStatus isOk={false} icon={Globe} tip={t("vpn_network")} />;
    }

    return <NetworkStatus isOk={data} icon={Globe} tip={t("vpn_network")} />;
}