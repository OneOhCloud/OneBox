import { useSubscriptions } from "../../hooks/useDB";
import { t, vpnServiceManager } from "../../utils/helper";
import { AppleNetworkStatus, GoogleNetworkStatus } from "./network-check";
import SelectSub from "./select-config";
import SelectNode from "./select-node";

function SectionLabel({
    children,
    trailing,
}: {
    children: React.ReactNode;
    trailing?: React.ReactNode;
}) {
    return (
        <div className="flex items-center justify-between px-1 mb-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500 capitalize">
                {children}
            </span>
            {trailing && (
                <div className="flex items-center gap-2">{trailing}</div>
            )}
        </div>
    );
}

export default function Body({
    isRunning,
    onUpdate,
}: {
    isRunning: boolean;
    onUpdate: () => void;
}) {
    const { data, isLoading } = useSubscriptions();

    const handleUpdate = async (_identifier: string, isUpdate: boolean) => {
        try {
            if (isUpdate && isRunning) {
                await vpnServiceManager.syncConfig({});
                onUpdate();
            }
        } catch (error) {
            console.error(t("update_config_failed") + ":", error);
        }
    };

    return (
        <div className="w-full space-y-4">
            <section className="w-full">
                <SectionLabel
                    trailing={
                        <>
                            <AppleNetworkStatus />
                            <GoogleNetworkStatus isRunning={isRunning} />
                        </>
                    }
                >
                    {t("current_subscription")}
                </SectionLabel>
                <SelectSub
                    onUpdate={handleUpdate}
                    data={data}
                    isLoading={isLoading}
                />
            </section>

            <section className="w-full">
                <SectionLabel>{t("node_selection")}</SectionLabel>
                <SelectNode isRunning={isRunning} />
            </section>
        </div>
    );
}
