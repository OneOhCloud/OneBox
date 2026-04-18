import { openUrl } from "@tauri-apps/plugin-opener";
import bytes from "bytes";
import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import React, { useEffect, useState } from "react";
import { ArrowClockwise, ChevronDown, InfoCircle, Trash3 } from "react-bootstrap-icons";
import { mutate } from "swr";
import { deleteSubscription } from "../../action/db";
import { useUpdateSubscription } from "../../action/subscription-hooks";
import { GET_SUBSCRIPTIONS_LIST_SWR_KEY, Subscription } from "../../types/definition";
import { t } from "../../utils/helper";
import Avatar from "./avatar";
import { SubscriptionDetailModal } from "./detail-modal";

interface SubscriptionItemProps {
    item: Subscription;
    expanded: string;
    setExpanded: (id: string) => void;
    onUpdateDone: () => void;
}

const LOCAL_FILE_SENTINEL = 32503680000000;

const messageStyles = {
    error: { color: "#FF3B30", bg: "rgba(255, 59, 48, 0.1)" },
    success: { color: "#34C759", bg: "rgba(52, 199, 89, 0.12)" },
    warning: { color: "#FF9500", bg: "rgba(255, 149, 0, 0.1)" },
} as const;

export const SubscriptionItem: React.FC<SubscriptionItemProps> = ({
    item,
    expanded,
    setExpanded,
    onUpdateDone,
}) => {
    const isExpanded = expanded === item.identifier;
    const usage = Math.floor((item.used_traffic / item.total_traffic) * 100);
    const danger = usage >= 100;
    const remainingDays = Math.floor(
        (item.expire_time - item.last_update_time) / (1000 * 60 * 60 * 24),
    );
    const isLocalFile = item.expire_time === LOCAL_FILE_SENTINEL;

    const trafficText = `${bytes(item.used_traffic) ?? "0"} / ${bytes(item.total_traffic) ?? "0"}`;
    const remainingText = isLocalFile
        ? t("local_file_no_expire")
        : `${remainingDays} ${t("days")}`;

    const { update, resetMessage, loading, message, messageType } =
        useUpdateSubscription();
    const [isDeleting, setIsDeleting] = useState(false);
    const [detailOpen, setDetailOpen] = useState(false);

    useEffect(() => {
        if (!loading) {
            const timer = setTimeout(() => resetMessage(), 5000);
            return () => clearTimeout(timer);
        }
    }, [loading, message]);

    useEffect(() => {
        const handleUpdateEvent = async () => {
            await update(item.identifier);
            onUpdateDone();
        };
        window.addEventListener("update-all-subscriptions", handleUpdateEvent);
        return () => {
            window.removeEventListener(
                "update-all-subscriptions",
                handleUpdateEvent,
            );
        };
    }, [item.identifier]);

    const handleDelete = async () => {
        setIsDeleting(true);
        await deleteSubscription(item.identifier);
        await new Promise((resolve) => setTimeout(resolve, 100));
        setIsDeleting(false);
        await mutate(GET_SUBSCRIPTIONS_LIST_SWR_KEY);
    };

    const handleUpdate = async () => {
        await update(item.identifier);
        await mutate(GET_SUBSCRIPTIONS_LIST_SWR_KEY);
    };

    const handleToggleExpand = () => {
        setExpanded(isExpanded ? "" : item.identifier);
    };

    const handleAvatarClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (item.official_website && item.official_website.startsWith("http")) {
            openUrl(item.official_website);
        }
    };

    const isBusy = loading || isDeleting;
    const progressWidth = Math.min(usage, 100);
    const progressColor = danger ? "#FF3B30" : "var(--onebox-blue)";

    const pillStyle =
        message && messageType && messageStyles[messageType as keyof typeof messageStyles];

    const titleText = isDeleting
        ? t("deleting_subscription")
        : loading
            ? t("updating")
            : item.name;

    return (
        <li>
            <button
                type="button"
                onClick={isBusy ? undefined : handleToggleExpand}
                disabled={isBusy}
                className={clsx(
                    "w-full flex items-center gap-3 px-4 py-3 text-left",
                    "transition-colors duration-150",
                    !isBusy &&
                        "hover:bg-[rgba(60,60,67,0.025)] active:bg-[rgba(60,60,67,0.06)]",
                    isBusy && "opacity-60",
                )}
            >
                <div onClick={handleAvatarClick}>
                    <Avatar url={item.official_website} danger={danger} />
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                        <span
                            className="text-[14.5px] font-medium truncate tracking-[-0.01em]"
                            style={{
                                color: danger
                                    ? "#FF3B30"
                                    : "var(--onebox-label)",
                            }}
                        >
                            {titleText}
                        </span>
                        {pillStyle && (
                            <span
                                className="shrink-0 inline-flex items-center px-1.5 py-0.25 rounded-md text-[10px] font-medium whitespace-nowrap"
                                style={{
                                    color: pillStyle.color,
                                    background: pillStyle.bg,
                                }}
                            >
                                {message}
                            </span>
                        )}
                    </div>

                    <div
                        className="mt-0.5 text-[11px] tabular-nums truncate"
                        style={{ color: "var(--onebox-label-secondary)" }}
                    >
                        {isLocalFile ? (
                            remainingText
                        ) : (
                            <>
                                {trafficText}
                                <span className="mx-1.5 opacity-50">·</span>
                                {remainingText}
                            </>
                        )}
                    </div>

                    <div
                        className={clsx(
                            "mt-1.5 h-0.75 rounded-full overflow-hidden",
                            isBusy && "animate-pulse",
                        )}
                        style={{ background: "rgba(60, 60, 67, 0.09)" }}
                    >
                        <div
                            className="h-full rounded-full"
                            style={{
                                width: `${progressWidth}%`,
                                background: progressColor,
                                transition: "width 400ms cubic-bezier(0.32, 0.72, 0, 1), background 280ms",
                            }}
                        />
                    </div>
                </div>

                <ChevronDown
                    size={12}
                    className="shrink-0"
                    style={{
                        color: "rgba(60, 60, 67, 0.3)",
                        transition: "transform 220ms cubic-bezier(0.32, 0.72, 0, 1)",
                        transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                    }}
                />
            </button>

            <AnimatePresence initial={false}>
                {isExpanded && !isBusy && (
                    <motion.div
                        key="actions"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{
                            duration: 0.22,
                            ease: [0.32, 0.72, 0, 1],
                        }}
                        className="overflow-hidden"
                    >
                        <div
                            className="grid grid-cols-3 relative"
                            style={{
                                borderTop: "0.5px solid var(--onebox-separator)",
                            }}
                        >
                            <button
                                type="button"
                                onClick={() => setDetailOpen(true)}
                                className="py-2.5 flex items-center justify-center gap-1.5 text-[13px] font-medium transition-colors active:bg-[rgba(0,122,255,0.06)]"
                                style={{ color: "var(--onebox-blue)" }}
                            >
                                <InfoCircle size={13} />
                                <span>{t("details")}</span>
                            </button>
                            <button
                                type="button"
                                onClick={handleUpdate}
                                className="py-2.5 flex items-center justify-center gap-1.5 text-[13px] font-medium transition-colors active:bg-[rgba(0,122,255,0.06)]"
                                style={{
                                    color: "var(--onebox-blue)",
                                    borderLeft: "0.5px solid var(--onebox-separator)",
                                    borderRight: "0.5px solid var(--onebox-separator)",
                                }}
                            >
                                <ArrowClockwise size={13} />
                                <span>{t("update")}</span>
                            </button>
                            <button
                                type="button"
                                onClick={handleDelete}
                                className="py-2.5 flex items-center justify-center gap-1.5 text-[13px] font-medium transition-colors active:bg-[rgba(255,59,48,0.06)]"
                                style={{ color: "#FF3B30" }}
                            >
                                <Trash3 size={13} />
                                <span>{t("delete")}</span>
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <SubscriptionDetailModal
                item={item}
                isOpen={detailOpen}
                onClose={() => setDetailOpen(false)}
            />
        </li>
    );
};
