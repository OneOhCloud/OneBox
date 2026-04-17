import { listen } from "@tauri-apps/api/event";
import { type } from "@tauri-apps/plugin-os";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { ArrowClockwise, CloudPlus, Plus } from "react-bootstrap-icons";
import { mutate } from "swr";
import { addSubscription } from "../action/db";
import { SubscriptionItem } from "../components/configuration/item";
import { useSubscriptionModalController } from "../components/configuration/modal";
import { useSubscriptions } from "../hooks/useDB";
import { getStoreValue } from "../single/store";
import {
    GET_SUBSCRIPTIONS_LIST_SWR_KEY,
    SUPPORT_LOCAL_FILE_STORE_KEY,
} from "../types/definition";
import { t } from "../utils/helper";


function ConfigurationHeader() {
    useEffect(() => {
        const setupListener = async () => {
            const unListen = await listen("tauri://drag-drop", async (event) => {
                const flag = await getStoreValue(
                    SUPPORT_LOCAL_FILE_STORE_KEY,
                    false,
                );
                if (!flag) {
                    console.log("Local file import is disabled");
                    return;
                }
                let fileName = "";
                const path = `file://${(event as any).payload.paths[0]}`;
                if (type() == "windows") {
                    fileName = (event as any).payload.paths[0]
                        .split("\\")
                        .pop();
                } else {
                    fileName = (event as any).payload.paths[0]
                        .split("/")
                        .pop();
                }
                await addSubscription(path, fileName);
                await mutate(GET_SUBSCRIPTIONS_LIST_SWR_KEY);
            });
            return unListen;
        };
        const unListenPromise = setupListener();
        return () => {
            unListenPromise.then((unListen) => unListen());
        };
    }, []);

    return (
        <div className="px-4 pt-5 pb-3">
            <h1
                className="text-[22px] font-semibold tracking-[-0.02em] capitalize"
                style={{ color: "var(--onebox-label)" }}
            >
                {t("subscription_management")}
            </h1>
        </div>
    );
}

export default function Configuration() {
    const { openModal, ModalElement } = useSubscriptionModalController();

    const handleUpdateAll = async () => {
        window.dispatchEvent(new CustomEvent("update-all-subscriptions"));
        // Allow the event to propagate to every mounted item which spins its
        // own updater; give a short delay so toasts from each don't stack
        // instantly, then bail.
        await new Promise((resolve) => setTimeout(resolve, 600));
    };

    return (
        <div className="onebox-scrollpage flex flex-col">
            <ConfigurationHeader />
            <div className="flex-1 min-h-0 overflow-hidden">
                <ConfigurationBody
                    onAdd={openModal}
                    onUpdateAll={handleUpdateAll}
                />
            </div>
            {ModalElement}
        </div>
    );
}


function ConfigurationBody({
    onAdd,
    onUpdateAll,
}: {
    onAdd: () => void;
    onUpdateAll: () => Promise<void>;
}) {
    const [expanded, setExpanded] = useState("");
    const { data, error, isLoading } = useSubscriptions();

    if (isLoading) {
        return (
            <div className="flex justify-center items-center pt-20">
                <p
                    className="text-sm"
                    style={{ color: "var(--onebox-label-secondary)" }}
                >
                    {t("loading")}
                </p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex justify-center items-center pt-20 px-4">
                <p className="text-sm text-red-500 text-center">
                    {String(error)}
                </p>
            </div>
        );
    }

    if (!data || !data.length) {
        return <EmptyState onAdd={onAdd} />;
    }

    return (
        <div className="h-full overflow-auto px-4 pb-5">
            <ul className="onebox-grouped-card list-none p-0">
                {data.map((item) => (
                    <SubscriptionItem
                        key={item.identifier}
                        item={item}
                        expanded={expanded}
                        setExpanded={setExpanded}
                        onUpdateDone={async () => {
                            await mutate(GET_SUBSCRIPTIONS_LIST_SWR_KEY);
                        }}
                    />
                ))}
            </ul>

            <ActionsCard onAdd={onAdd} onUpdateAll={onUpdateAll} />
        </div>
    );
}

// iOS-style bottom action card. Two full-width rows, systemBlue labels,
// inset hairline separator (provided by .onebox-grouped-card). Sits below
// the subscription list so users see their content first, actions second.
function ActionsCard({
    onAdd,
    onUpdateAll,
}: {
    onAdd: () => void;
    onUpdateAll: () => Promise<void>;
}) {
    const [isUpdating, setIsUpdating] = useState(false);

    const handleUpdate = async () => {
        if (isUpdating) return;
        setIsUpdating(true);
        try {
            await onUpdateAll();
        } finally {
            setIsUpdating(false);
        }
    };

    return (
        <div className="onebox-grouped-card mt-4">
            <ActionRow
                icon={
                    <motion.div
                        animate={isUpdating ? { rotate: 360 } : { rotate: 0 }}
                        transition={
                            isUpdating
                                ? {
                                      duration: 1,
                                      repeat: Infinity,
                                      ease: "linear",
                                  }
                                : { duration: 0.3, ease: "easeOut" }
                        }
                    >
                        <ArrowClockwise
                            size={18}
                            style={{ color: "var(--onebox-blue)" }}
                        />
                    </motion.div>
                }
                label={
                    isUpdating
                        ? t("updating")
                        : t("update_all_subscriptions")
                }
                disabled={isUpdating}
                onPress={handleUpdate}
            />
            <ActionRow
                icon={
                    <Plus size={18} style={{ color: "var(--onebox-blue)" }} />
                }
                label={t("add_subscription")}
                onPress={onAdd}
            />
        </div>
    );
}

function ActionRow({
    icon,
    label,
    disabled,
    onPress,
}: {
    icon: React.ReactNode;
    label: string;
    disabled?: boolean;
    onPress: () => void;
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onPress}
            className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                disabled
                    ? "opacity-50 cursor-not-allowed"
                    : "hover:bg-[rgba(60,60,67,0.025)] active:bg-[rgba(60,60,67,0.06)]"
            }`}
        >
            <div className="size-7 flex items-center justify-center shrink-0">
                {icon}
            </div>
            <span
                className="flex-1 text-[15px] tracking-[-0.005em]"
                style={{ color: "var(--onebox-blue)" }}
            >
                {label}
            </span>
        </button>
    );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
    return (
        <div className="h-full flex flex-col items-center justify-center px-8 pb-20">
            <div
                className="size-16 rounded-[18px] flex items-center justify-center mb-5"
                style={{ background: "rgba(0, 122, 255, 0.1)" }}
            >
                <CloudPlus size={30} style={{ color: "var(--onebox-blue)" }} />
            </div>
            <h2
                className="text-[17px] font-semibold tracking-[-0.01em] mb-1.5"
                style={{ color: "var(--onebox-label)" }}
            >
                {t("no_subscription_config")}
            </h2>
            <p
                className="text-[13px] leading-snug text-center mb-6 max-w-[240px]"
                style={{ color: "var(--onebox-label-secondary)" }}
            >
                {t("no_subscription_hint")}
            </p>

            <button
                type="button"
                onClick={onAdd}
                className="h-10 px-5 rounded-full text-[14px] font-semibold transition-colors active:brightness-95"
                style={{
                    background: "var(--onebox-blue)",
                    color: "#FFFFFF",
                    boxShadow:
                        "0 2px 8px -2px rgba(0, 122, 255, 0.4), 0 1px 2px rgba(0, 0, 0, 0.05)",
                }}
            >
                {t("add_subscription")}
            </button>
        </div>
    );
}
