import { motion } from "framer-motion";
import { Globe, Icon, Reception4 } from "react-bootstrap-icons";
import { t } from "../../utils/helper";
import { useGoogleNetworkCheck, useGstaticNetworkCheck } from "./hooks";

type NetworkStatusProps = {
    isOk: boolean;
    icon: Icon;
    tip: string;
};

type NetworkCheckProps = {
    isRunning: boolean;
};

const LoadingStatus = ({ icon: Icon = Globe }) => (
    <motion.div title={t("loading")}>
        <Icon className="size-4" style={{ color: 'var(--onebox-label-tertiary)' }} />
    </motion.div>
);

// Normal/detected state uses the primary label color (white in dark, near-black in
// light) so a healthy link reads clearly. Fault state uses systemRed. Not-detected
// / not-running lives in the LoadingStatus / GoogleNetworkStatus off-branch, where
// label-tertiary (dim) is the correct "absent" signal per Apple HIG.
const NetworkStatus = ({ isOk, icon: Icon, tip }: NetworkStatusProps) => (
    <div title={`${tip}:${isOk ? t("network_normal") : t("network_abnormal")}`}>
        <Icon
            className="size-4 transition-colors duration-300"
            style={{ color: isOk ? 'var(--onebox-label)' : 'var(--onebox-red)' }}
        />
    </div>
);

export function AppleNetworkStatus() {
    const { data: ok, isLoading, error } = useGstaticNetworkCheck();

    if (error) {
        console.error("Network check error:", error);
        return <NetworkStatus
            isOk={false}
            icon={Reception4}
            tip={t("normal_network")}
        />;
    }

    if (isLoading || ok === undefined) return <LoadingStatus icon={Reception4} />;

    return <NetworkStatus
        isOk={ok}
        icon={Reception4}
        tip={t("normal_network")}
    />;
}

export function GoogleNetworkStatus({ isRunning }: NetworkCheckProps) {
    const { data, isLoading, error } = useGoogleNetworkCheck();

    if (!isRunning) return <Globe className="size-4" style={{ color: 'var(--onebox-label-tertiary)' }} />;
    if (isLoading || !data) return <LoadingStatus />;
    if (error) {
        return <NetworkStatus isOk={false} icon={Globe} tip={t("vpn_network")} />;
    }

    return <NetworkStatus isOk={data} icon={Globe} tip={t("vpn_network")} />;
}