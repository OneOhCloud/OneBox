import { invoke } from "@tauri-apps/api/core";
import { motion } from "framer-motion";
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

export function AppleNetworkStatus({ isRunning }: NetworkCheckProps) {
    const { data, isLoading, error } = useSWR(
        `swr-apple-${isRunning}-ping`,
        () => invoke<boolean>('ping_apple_captive'),
        { refreshInterval: 2000 }
    );

    if (isLoading) return <LoadingStatus icon={Reception4} />;
    if (error || data === null || data === undefined) {
        return <NetworkStatus isOk={false} icon={Reception4} tip={t("normal_network")} />;
    }

    return <NetworkStatus isOk={data} icon={Reception4} tip={t("normal_network")} />;
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