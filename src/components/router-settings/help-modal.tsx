import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";
import { ArrowClockwise, ChevronRight, X } from "react-bootstrap-icons";
import { RULE_ACTIONS, RULE_KINDS } from "../../config/merger/custom-rules";
import { t } from "../../utils/helper";
import { ActionBadge, KIND_META, KindChip } from "./rule-badges";

interface HelpModalProps {
    isOpen: boolean;
    onClose: () => void;
}

// iOS-style legend for the rules page. Three grouped sections — Action /
// Match / Priority — render the EXACT colored action badges and mono
// glyph-chips the user sees on rule rows (shared from rule-badges.tsx, so the
// legend can't drift from the list), plus a quiet restart footnote.
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
                        className="relative w-full max-w-[320px] rounded-[14px] overflow-hidden flex flex-col"
                        style={{
                            maxHeight: "calc(100dvh - 80px)",
                            background: "var(--onebox-card)",
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
                                    style={{ color: "var(--onebox-label-secondary)" }}
                                />
                            </button>
                        </div>

                        <div className="px-4 pb-4 space-y-4 overflow-y-auto">
                            {/* Action — color-coded, in priority order. */}
                            <Section label={t("rule_section_action", "Action")}>
                                {RULE_ACTIONS.map((a) => (
                                    <div key={a} className="flex items-center gap-2.5 px-3 py-2.5">
                                        <ActionBadge action={a} />
                                        <span
                                            className="text-[12px] leading-snug"
                                            style={{ color: "var(--onebox-label-secondary)" }}
                                        >
                                            {t(`${a}_rules_info`)}
                                        </span>
                                    </div>
                                ))}
                            </Section>

                            {/* Match — monochrome glyph-chips + example. */}
                            <Section label={t("rule_section_match", "Match")}>
                                {RULE_KINDS.map((k) => (
                                    <div key={k} className="flex items-center gap-2.5 px-3 py-2.5">
                                        <KindChip kind={k} />
                                        <span
                                            className="text-[13px] shrink-0"
                                            style={{ color: "var(--onebox-label)" }}
                                        >
                                            {t(`kind_${k}`)}
                                        </span>
                                        <span className="opacity-40 text-[12px]">·</span>
                                        <span
                                            className="text-[12px] min-w-0 truncate"
                                            style={{
                                                color: "var(--onebox-label-tertiary)",
                                                fontFamily:
                                                    '"SF Mono", ui-monospace, "Menlo", monospace',
                                            }}
                                        >
                                            {KIND_META[k].placeholder}
                                        </span>
                                    </div>
                                ))}
                            </Section>

                            {/* Priority — the colored order IS the lesson. */}
                            <Section label={t("rule_section_priority", "Priority")}>
                                <div className="px-3 py-2.5 space-y-1.5">
                                    <div className="flex items-center gap-1.5">
                                        {RULE_ACTIONS.map((a, i) => (
                                            <div key={a} className="flex items-center gap-1.5">
                                                {i > 0 && (
                                                    <ChevronRight
                                                        size={10}
                                                        style={{ color: "var(--onebox-label-tertiary)" }}
                                                    />
                                                )}
                                                <ActionBadge action={a} />
                                            </div>
                                        ))}
                                    </div>
                                    <p
                                        className="text-[12px] leading-snug"
                                        style={{ color: "var(--onebox-label-secondary)" }}
                                    >
                                        {t("rule_priority_hint")}
                                    </p>
                                </div>
                            </Section>

                            {/* Effect — neutral restart footnote (uncolored on purpose). */}
                            <p
                                className="flex items-center gap-1.5 px-1 text-[11px] leading-snug"
                                style={{ color: "var(--onebox-label-secondary)" }}
                            >
                                <ArrowClockwise size={12} className="shrink-0" />
                                {t("rules_effective_info")}
                            </p>
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

// A labeled grouped card — uppercase section header over a fill card whose
// rows carry the app-wide inset hairline separator.
function Section({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div>
            <p
                className="text-[11px] font-semibold uppercase tracking-[0.04em] mb-1.5 px-1"
                style={{ color: "var(--onebox-label-secondary)" }}
            >
                {label}
            </p>
            <div
                className="onebox-grouped-list rounded-xl overflow-hidden"
                style={{ background: "var(--onebox-fill)" }}
            >
                {children}
            </div>
        </div>
    );
}
