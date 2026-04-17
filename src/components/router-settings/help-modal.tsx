import { AnimatePresence, motion } from "framer-motion";
import { Globe, ShieldCheck, X } from "react-bootstrap-icons";
import { t } from "../../utils/helper";

interface HelpModalProps {
    isOpen: boolean;
    onClose: () => void;
}

// iOS-style informational modal. Two hero cards (Direct / Proxy rules),
// three rule-type explanations, one trailing note. No daisyUI dialog.
export function HelpModal({ isOpen, onClose }: HelpModalProps) {
    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    key="help-modal"
                    className="fixed inset-0 z-50 flex items-center justify-center px-4"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18 }}
                >
                    <div
                        className="absolute inset-0"
                        style={{
                            background: "rgba(15, 23, 42, 0.38)",
                            backdropFilter: "blur(6px)",
                            WebkitBackdropFilter: "blur(6px)",
                        }}
                        onClick={onClose}
                    />
                    <motion.div
                        className="relative w-full max-w-[320px] bg-white rounded-[14px] overflow-hidden flex flex-col"
                        style={{
                            maxHeight: "calc(100dvh - 80px)",
                            boxShadow:
                                "0 22px 48px -12px rgba(15, 23, 42, 0.3), 0 4px 14px rgba(15, 23, 42, 0.08)",
                        }}
                        initial={{ scale: 0.94, y: 8 }}
                        animate={{ scale: 1, y: 0 }}
                        exit={{ scale: 0.96, y: 4 }}
                        transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
                    >
                        <div className="relative flex items-center justify-center px-4 pt-4 pb-3">
                            <h3
                                className="text-[16px] font-semibold tracking-[-0.01em]"
                                style={{ color: "var(--onebox-label)" }}
                            >
                                {t("rule_info_title", "Rule Information")}
                            </h3>
                            <button
                                type="button"
                                onClick={onClose}
                                className="absolute right-3 top-3 size-7 rounded-full flex items-center justify-center transition-colors active:bg-[rgba(60,60,67,0.08)]"
                                aria-label={t("close")}
                            >
                                <X
                                    size={18}
                                    style={{
                                        color: "var(--onebox-label-secondary)",
                                    }}
                                />
                            </button>
                        </div>

                        <div className="px-4 pb-4 space-y-3 overflow-y-auto">
                            <InfoCard
                                icon={
                                    <ShieldCheck
                                        size={16}
                                        style={{ color: "var(--onebox-blue)" }}
                                    />
                                }
                                title={t("direct_rules", "Direct Rules")}
                                body={t(
                                    "direct_rules_info",
                                    "Direct rules: Traffic will bypass proxy",
                                )}
                            />
                            <InfoCard
                                icon={
                                    <Globe
                                        size={16}
                                        style={{ color: "var(--onebox-blue)" }}
                                    />
                                }
                                title={t("proxy_rules", "Proxy Rules")}
                                body={t(
                                    "proxy_rules_info",
                                    "Proxy rules: Traffic will go through proxy",
                                )}
                            />

                            <div
                                className="text-[12px] leading-relaxed space-y-1.5 px-1"
                                style={{ color: "var(--onebox-label-secondary)" }}
                            >
                                <BulletItem
                                    label={t("domain_rules", "Domain Rules")}
                                    desc={t(
                                        "domain_rules_desc",
                                        "Match exact domain names, e.g., example.com",
                                    )}
                                />
                                <BulletItem
                                    label={t(
                                        "domain_suffix_rules",
                                        "Domain Suffix Rules",
                                    )}
                                    desc={t(
                                        "domain_suffix_rules_desc",
                                        "Match domain suffixes, e.g., .com, .cn",
                                    )}
                                />
                                <BulletItem
                                    label={t("ip_cidr_rules", "IP CIDR Rules")}
                                    desc={t(
                                        "ip_cidr_rules_desc",
                                        "Match IP ranges, e.g., 192.168.1.0/24",
                                    )}
                                />
                            </div>

                            <div
                                className="rounded-xl px-3 py-2 text-[12px] leading-snug"
                                style={{
                                    background: "rgba(0, 122, 255, 0.08)",
                                    color: "var(--onebox-blue)",
                                }}
                            >
                                {t(
                                    "rules_auto_save",
                                    "Rules are automatically saved when added or removed",
                                )}
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={onClose}
                            className="w-full h-11 text-[14px] font-semibold transition-colors active:bg-[rgba(0,122,255,0.08)] shrink-0"
                            style={{
                                color: "var(--onebox-blue)",
                                borderTop: "0.5px solid var(--onebox-separator)",
                            }}
                        >
                            {t("close", "Close")}
                        </button>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

function InfoCard({
    icon,
    title,
    body,
}: {
    icon: React.ReactNode;
    title: string;
    body: string;
}) {
    return (
        <div
            className="rounded-xl px-3 py-2.5"
            style={{ background: "rgba(118, 118, 128, 0.08)" }}
        >
            <div
                className="flex items-center gap-2 text-[13px] font-medium mb-1"
                style={{ color: "var(--onebox-label)" }}
            >
                {icon}
                <span>{title}</span>
            </div>
            <p
                className="text-[12px] leading-snug"
                style={{ color: "var(--onebox-label-secondary)" }}
            >
                {body}
            </p>
        </div>
    );
}

function BulletItem({ label, desc }: { label: string; desc: string }) {
    return (
        <p>
            <span
                className="font-medium"
                style={{ color: "var(--onebox-label)" }}
            >
                {label}
            </span>
            <span className="mx-1">·</span>
            <span>{desc}</span>
        </p>
    );
}
