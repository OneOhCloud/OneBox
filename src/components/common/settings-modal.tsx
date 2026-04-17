import { AnimatePresence, motion } from "framer-motion";
import { ReactNode } from "react";
import { t } from "../../utils/helper";
import { Portal } from "./portal";

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    subtitle?: string;
    children: ReactNode;
    cancelLabel?: string;
    confirmLabel?: string;
    onConfirm?: () => void;
    confirmDisabled?: boolean;
    confirmLoading?: boolean;
    confirmDestructive?: boolean;
    maxWidth?: number;
}

/**
 * iOS UIAlertController-shaped modal shell.
 *
 * - Title centered at top (16px semibold).
 * - Optional subtitle underneath (13px secondary).
 * - Arbitrary body passed via children.
 * - Bottom action bar: single Cancel/Close button (full width) when no
 *   confirm action provided, or a two-column split (Cancel | Confirm)
 *   with a vertical hairline between — the exact iOS UIAlert pattern.
 *   Confirm is rendered semibold systemBlue; pass `confirmDestructive`
 *   to paint it systemRed (for "Delete" / "Reset" style actions).
 * - Backdrop is tinted + blurred; click to dismiss.
 * - All portalled to body to survive grouped-card descendant CSS.
 */
export function SettingsModal({
    isOpen,
    onClose,
    title,
    subtitle,
    children,
    cancelLabel,
    confirmLabel,
    onConfirm,
    confirmDisabled,
    confirmLoading,
    confirmDestructive,
    maxWidth = 310,
}: SettingsModalProps) {
    const hasConfirm = !!onConfirm && !!confirmLabel;
    const confirmColor = confirmDestructive ? "#FF3B30" : "var(--onebox-blue)";

    return (
        <Portal>
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        key="settings-modal"
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
                            className="relative w-full bg-white rounded-[14px] overflow-hidden"
                            style={{
                                maxWidth,
                                boxShadow:
                                    "0 22px 48px -12px rgba(15, 23, 42, 0.3), 0 4px 14px rgba(15, 23, 42, 0.08)",
                            }}
                            initial={{ scale: 0.94, y: 8 }}
                            animate={{ scale: 1, y: 0 }}
                            exit={{ scale: 0.96, y: 4 }}
                            transition={{
                                duration: 0.22,
                                ease: [0.32, 0.72, 0, 1],
                            }}
                        >
                            <div className="pt-5 px-4">
                                <h3
                                    className="text-[16px] font-semibold text-center tracking-[-0.01em] capitalize"
                                    style={{ color: "var(--onebox-label)" }}
                                >
                                    {title}
                                </h3>
                                {subtitle && (
                                    <p
                                        className="text-[12px] text-center mt-1.5 leading-snug"
                                        style={{
                                            color: "var(--onebox-label-secondary)",
                                        }}
                                    >
                                        {subtitle}
                                    </p>
                                )}
                            </div>

                            <div className="px-4 py-4">{children}</div>

                            {hasConfirm ? (
                                <div
                                    className="grid grid-cols-2"
                                    style={{
                                        borderTop:
                                            "0.5px solid var(--onebox-separator)",
                                    }}
                                >
                                    <button
                                        type="button"
                                        className="h-11 text-[14px] transition-colors active:bg-[rgba(60,60,67,0.05)]"
                                        style={{ color: "var(--onebox-blue)" }}
                                        onClick={onClose}
                                    >
                                        {cancelLabel ?? t("cancel")}
                                    </button>
                                    <button
                                        type="button"
                                        disabled={
                                            confirmDisabled || confirmLoading
                                        }
                                        onClick={onConfirm}
                                        className="h-11 text-[14px] font-semibold transition-colors active:bg-[rgba(0,122,255,0.08)] disabled:opacity-40 disabled:cursor-not-allowed"
                                        style={{
                                            color: confirmColor,
                                            borderLeft:
                                                "0.5px solid var(--onebox-separator)",
                                        }}
                                    >
                                        {confirmLoading
                                            ? t("saving", "Saving...")
                                            : confirmLabel}
                                    </button>
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    className="w-full h-11 text-[14px] font-semibold transition-colors active:bg-[rgba(0,122,255,0.08)]"
                                    style={{
                                        color: "var(--onebox-blue)",
                                        borderTop:
                                            "0.5px solid var(--onebox-separator)",
                                    }}
                                    onClick={onClose}
                                >
                                    {cancelLabel ?? t("close")}
                                </button>
                            )}
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </Portal>
    );
}
