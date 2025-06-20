
import { invoke } from "@tauri-apps/api/core";
import { motion } from "framer-motion";
import { Globe, Reception4 } from "react-bootstrap-icons";
import useSWR from "swr";
import { t } from "../../utils/helper";

const NetworkStatus = ({ isOk, icon: Icon, tip }: { isOk: boolean; icon: typeof Globe; tip: string }) => (
    <div
        className="tooltip tooltip-left"
        data-tip={`${tip}:${isOk ? t("network_normal") : t("network_abnormal")}`}

    >
        <Icon className={`size-4 ${isOk ? 'text-gray-500' : 'text-red-500'} transition-colors duration-300`} />
    </div>
);


type Props = {
    isRunning: boolean;
}

export function AppleNetworkStatus(props: Props) {

    const { isRunning } = props;

    const { data, isLoading, error } = useSWR(`swr-apple-${isRunning}`, () => {
        if (!isRunning) return false;

        return invoke<boolean>('ping_apple_captive')
    }, { refreshInterval: 2000 });

    if (!isRunning || !data) return <></>;

    if (error) {
        return (
            <NetworkStatus isOk={false} icon={Reception4} tip={
                t("normal_network")
            } />
        );
    }

    if (isLoading) return (
        <motion.div
            className="tooltip tooltip-left"
            data-tip={t("loading")}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, type: "spring", stiffness: 200 }}
            whileHover={{ scale: 1.1 }}
        >
            <Globe className={`size-4 text-gray-500 animate-spin`} />
        </motion.div>
    )

    return (
        <NetworkStatus isOk={data ?? true} icon={Reception4} tip={
            t("normal_network")
        } />
    )

}

export function GoogleNetworkStatus(props: Props) {
    const { isRunning } = props;

    const { data, isLoading, error } = useSWR(`swr-google-${isRunning}`, () => {
        if (!isRunning) return false;

        return invoke<boolean>('ping_google')
    }, { refreshInterval: 2000 });

    if (!isRunning || !data) return <></>;



    if (isLoading) return (
        <div
            className="tooltip tooltip-left"
            data-tip={t("loading")}

        >
            <Globe className={`size-4 text-gray-500 animate-spin`} />
        </div>
    )

    if (error) {
        return (
            <NetworkStatus isOk={false} icon={Globe} tip={
                t("vpn_network")
            } />
        );
    }


    return (
        <NetworkStatus isOk={data ?? true} icon={Globe} tip={
            t("vpn_network")
        } />
    )
}