import { motion } from "framer-motion";
import { Globe, Icon, Reception4 } from "react-bootstrap-icons";
import { t } from "../../utils/helper";
import { useAppleNetworkCheck, useGoogleNetworkCheck } from "./hook";

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
        <Icon className="size-4 text-gray-300 " />
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
    const { data, isLoading, error } = useAppleNetworkCheck(isRunning);

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
    const { data, isLoading, error } = useGoogleNetworkCheck(isRunning);

    if (!isRunning) return <Globe className="size-4 text-gray-100 " />;
    if (isLoading || !data) return <LoadingStatus />;
    if (error) {
        return <NetworkStatus isOk={false} icon={Globe} tip={t("vpn_network")} />;
    }

    return <NetworkStatus isOk={data} icon={Globe} tip={t("vpn_network")} />;
}