import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import { type } from "@tauri-apps/plugin-os";
import { motion } from "framer-motion";
import { Globe, Icon, Reception4 } from "react-bootstrap-icons";
import { toast } from "sonner";
import { t } from "../../utils/helper";
import { canRepairDns, DnsRepairOutcome, wlanStatusLabelKey } from "../../utils/wlan-status";
import { useGoogleNetworkCheck, useGstaticNetworkCheck } from "./hooks";

type NetworkStatusProps = {
    isOk: boolean;
    icon: Icon;
    tip: string;
    /** Overrides the generic normal / abnormal wording. */
    label?: string;
    onClick?: () => void;
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
const NetworkStatus = ({ isOk, icon: Icon, tip, label, onClick }: NetworkStatusProps) => {
    const title = `${tip}:${label ?? (isOk ? t("network_normal") : t("network_abnormal"))}`;
    const glyph = (
        <Icon
            className="size-4 transition-colors duration-300"
            style={{ color: isOk ? 'var(--onebox-label)' : 'var(--onebox-red)' }}
        />
    );

    if (!onClick) return <div title={title}>{glyph}</div>;

    return (
        <button type="button" title={title} aria-label={title} onClick={onClick} className="flex cursor-pointer">
            {glyph}
        </button>
    );
};

async function repairSystemDns() {
    const answer = await confirm(t("dns_repair_confirm"), {
        title: t("network_dns_abnormal"),
        kind: 'warning',
    });
    if (!answer) return;

    try {
        const outcome = await invoke<DnsRepairOutcome>('engine_repair_system_dns');
        if (outcome === 'repaired') {
            toast.success(t("dns_repaired"));
        } else {
            toast(t("dns_nothing_to_repair"));
        }
    } catch (error) {
        toast.error(`${t("dns_repair_failed")}: ${error}`);
    }
}

export function AppleNetworkStatus() {
    const { data: status, isLoading, error, mutate } = useGstaticNetworkCheck();

    if (error) {
        console.error("Network check error:", error);
        return <NetworkStatus
            isOk={false}
            icon={Reception4}
            tip={t("normal_network")}
        />;
    }

    if (isLoading || status === undefined) return <LoadingStatus icon={Reception4} />;

    const onRepairDns = canRepairDns(status, type())
        ? async () => {
            await repairSystemDns();
            await mutate();
        }
        : undefined;

    return <NetworkStatus
        isOk={status === 'online'}
        icon={Reception4}
        tip={t("normal_network")}
        label={t(wlanStatusLabelKey(status))}
        onClick={onRepairDns}
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
