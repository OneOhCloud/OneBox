import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import {
    Plus,
    QuestionCircle,
    XCircleFill,
} from "react-bootstrap-icons";
import { toast } from "sonner";
import { IOSTextField } from "../components/common/ios-text-field";
import { HelpModal } from "../components/router-settings/help-modal";
import { getCustomRuleSet, setCustomRuleSet } from "../single/store";
import { t } from "../utils/helper";

type RuleType = "direct" | "proxy";
type RuleKind = "domain" | "domain_suffix" | "ip_cidr";

interface RuleSet {
    domain: string[];
    domain_suffix: string[];
    ip_cidr: string[];
}

interface FlatRule {
    kind: RuleKind;
    value: string;
    // Index within the kind's original array — needed for splice-by-index
    // removal without identity games.
    index: number;
}

const KIND_LABEL: Record<RuleKind, string> = {
    domain: "Domain",
    domain_suffix: "Suffix",
    ip_cidr: "CIDR",
};

const KIND_CHIP: Record<RuleKind, string> = {
    domain: "DOM",
    domain_suffix: "SFX",
    ip_cidr: "CIDR",
};

const KIND_COLOR: Record<RuleKind, { fg: string; bg: string }> = {
    domain: { fg: "#007AFF", bg: "rgba(0, 122, 255, 0.12)" },
    domain_suffix: { fg: "#FF9500", bg: "rgba(255, 149, 0, 0.12)" },
    ip_cidr: { fg: "#34C759", bg: "rgba(52, 199, 89, 0.12)" },
};

const KIND_PLACEHOLDER: Record<RuleKind, string> = {
    domain: "example.com",
    domain_suffix: ".example.com",
    ip_cidr: "192.168.1.0/24",
};

function flattenRules(rules: RuleSet): FlatRule[] {
    const out: FlatRule[] = [];
    rules.domain.forEach((value, index) =>
        out.push({ kind: "domain", value, index }),
    );
    rules.domain_suffix.forEach((value, index) =>
        out.push({ kind: "domain_suffix", value, index }),
    );
    rules.ip_cidr.forEach((value, index) =>
        out.push({ kind: "ip_cidr", value, index }),
    );
    return out;
}

const EMPTY: RuleSet = { domain: [], domain_suffix: [], ip_cidr: [] };

export default function RouterSettings() {
    const [activeTab, setActiveTab] = useState<RuleType>("direct");
    const [rules, setRules] = useState<Record<RuleType, RuleSet>>({
        direct: EMPTY,
        proxy: EMPTY,
    });
    const [selectedKind, setSelectedKind] = useState<RuleKind>("domain");
    const [input, setInput] = useState("");
    const [showHelp, setShowHelp] = useState(false);

    useEffect(() => {
        const load = async () => {
            try {
                const [direct, proxy] = await Promise.all([
                    getCustomRuleSet("direct"),
                    getCustomRuleSet("proxy"),
                ]);
                setRules({ direct, proxy });
            } catch {
                toast.error(t("load_rules_failed", "Failed to load rules"));
            }
        };
        load();
    }, []);

    const currentRules = rules[activeTab];
    const flatRules = useMemo(
        () => flattenRules(currentRules),
        [currentRules],
    );

    const persist = async (type: RuleType, next: RuleSet) => {
        setRules((prev) => ({ ...prev, [type]: next }));
        await setCustomRuleSet(type, next);
    };

    const handleAdd = () => {
        const value = input.trim();
        if (!value) {
            toast.error(t("input_empty", "Input cannot be empty"));
            return;
        }
        if (currentRules[selectedKind].includes(value)) {
            toast.error(t("rule_exists", "Rule already exists"));
            return;
        }
        const next: RuleSet = {
            ...currentRules,
            [selectedKind]: [...currentRules[selectedKind], value],
        };
        persist(activeTab, next);
        setInput("");
        toast.success(t("add_success", "Added successfully"));
    };

    const handleRemove = (kind: RuleKind, index: number) => {
        const next: RuleSet = {
            ...currentRules,
            [kind]: currentRules[kind].filter((_, i) => i !== index),
        };
        persist(activeTab, next);
        toast.success(t("delete_success", "Deleted successfully"));
    };

    return (
        <div className="onebox-scrollpage">
            <HelpModal isOpen={showHelp} onClose={() => setShowHelp(false)} />

            <div className="onebox-page-inner !pt-3 pb-6">
                {/* Mode — Direct vs Proxy */}
                <Segmented
                    options={[
                        { id: "direct", label: t("direct_rules") },
                        { id: "proxy", label: t("proxy_rules") },
                    ]}
                    value={activeTab}
                    onChange={(v) => setActiveTab(v as RuleType)}
                />

                {/* Add form. Type tags (no wrapping trough — just inline
                    pills, active one gets systemBlue tint) + input row.
                    Collapsing the old segmented-trough layer removes one
                    whole gray translucent surface from the stack. */}
                <div className="mt-5">
                    <div className="flex items-center gap-1 px-0.5 mb-2">
                        {(["domain", "domain_suffix", "ip_cidr"] as RuleKind[]).map(
                            (k) => {
                                const active = selectedKind === k;
                                return (
                                    <button
                                        key={k}
                                        type="button"
                                        onClick={() => setSelectedKind(k)}
                                        className="h-7 px-3 rounded-full text-[12px] tracking-[-0.005em] transition-colors"
                                        style={{
                                            background: active
                                                ? "rgba(0, 122, 255, 0.12)"
                                                : "transparent",
                                            color: active
                                                ? "var(--onebox-blue)"
                                                : "var(--onebox-label-secondary)",
                                            fontWeight: active ? 600 : 400,
                                        }}
                                    >
                                        {KIND_LABEL[k]}
                                    </button>
                                );
                            },
                        )}
                    </div>
                    <div className="flex gap-2">
                        <IOSTextField
                            className="flex-1"
                            value={input}
                            onChange={setInput}
                            placeholder={KIND_PLACEHOLDER[selectedKind]}
                            onSubmit={handleAdd}
                            monospace
                        />
                        <button
                            type="button"
                            onClick={handleAdd}
                            disabled={!input.trim()}
                            className="shrink-0 size-10 rounded-xl flex items-center justify-center transition-all active:brightness-95 disabled:opacity-40 disabled:cursor-not-allowed"
                            style={{
                                background: "var(--onebox-blue)",
                                color: "#FFFFFF",
                                boxShadow: input.trim()
                                    ? "0 1px 3px rgba(0, 122, 255, 0.3)"
                                    : "none",
                            }}
                            aria-label={t("add")}
                        >
                            <Plus size={20} />
                        </button>
                    </div>
                </div>

                {/* Rules list — inline count + help icon, then the list. */}
                <div className="flex items-center justify-between mt-6 mb-1.5 px-1">
                    <h3
                        className="text-[11px] font-semibold uppercase tracking-[0.04em]"
                        style={{ color: "var(--onebox-label-secondary)" }}
                    >
                        {t("rules_count_label", "Rules")}
                        {` · ${flatRules.length}`}
                    </h3>
                    <button
                        type="button"
                        onClick={() => setShowHelp(true)}
                        className="p-1 rounded-full transition-colors active:bg-[rgba(0,122,255,0.08)]"
                        aria-label={t("rule_info_title", "Rule Information")}
                    >
                        <QuestionCircle
                            size={13}
                            style={{
                                color: "var(--onebox-label-secondary)",
                            }}
                        />
                    </button>
                </div>

                <AnimatePresence mode="wait">
                    <motion.div
                        key={activeTab}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -3 }}
                        transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
                    >
                        {flatRules.length > 0 ? (
                            <div className="onebox-grouped-card">
                                {flatRules.map((rule) => (
                                    <RuleRow
                                        key={`${rule.kind}-${rule.index}-${rule.value}`}
                                        rule={rule}
                                        onRemove={() =>
                                            handleRemove(rule.kind, rule.index)
                                        }
                                    />
                                ))}
                            </div>
                        ) : (
                            <div
                                className="onebox-plain-card px-4 py-8 text-center text-[13px]"
                                style={{
                                    color: "var(--onebox-label-tertiary)",
                                }}
                            >
                                {t("no_rules", "No rules yet")}
                            </div>
                        )}
                    </motion.div>
                </AnimatePresence>

                {/* Unified footer — mode explainer + restart reminder. The
                    mode hint swaps with the active tab (Direct/Proxy) so it
                    carries the contextual-mode info the removed banner
                    used to provide, without needing a separate block. */}
                <p
                    className="px-1 mt-3 text-[11px] leading-snug"
                    style={{ color: "var(--onebox-label-secondary)" }}
                >
                    {t(`${activeTab}_rules_hint`)}
                    <span className="mx-1.5 opacity-50">·</span>
                    {t(
                        "rules_effective_info",
                        "Rules take effect after restarting the VPN",
                    )}
                </p>
            </div>
        </div>
    );
}

function RuleRow({
    rule,
    onRemove,
}: {
    rule: FlatRule;
    onRemove: () => void;
}) {
    const color = KIND_COLOR[rule.kind];
    return (
        <div className="group flex items-center gap-2.5 px-3 py-2.5">
            <span
                className="inline-flex items-center justify-center h-4.5 px-1.5 rounded text-[10px] font-semibold tracking-wide shrink-0"
                style={{
                    background: color.bg,
                    color: color.fg,
                    minWidth: 38,
                }}
            >
                {KIND_CHIP[rule.kind]}
            </span>
            <span
                className="flex-1 min-w-0 text-[13px] truncate"
                style={{
                    color: "var(--onebox-label)",
                    fontFamily:
                        '"SF Mono", ui-monospace, "Menlo", monospace',
                }}
            >
                {rule.value}
            </span>
            <button
                type="button"
                onClick={onRemove}
                className="shrink-0 p-0.5 rounded-full transition-colors active:bg-[rgba(255,59,48,0.08)]"
                aria-label={t("delete")}
            >
                <XCircleFill
                    size={16}
                    className="opacity-55 hover:opacity-95"
                    style={{ color: "rgba(60, 60, 67, 0.55)" }}
                />
            </button>
        </div>
    );
}

/**
 * iOS-style segmented control. Single-row track with a sliding white
 * pill behind the active option. Accepts any number of options; grid
 * columns adapt via inline style.
 */
function Segmented<T extends string>({
    options,
    value,
    onChange,
    compact = false,
}: {
    options: { id: T; label: string }[];
    value: T;
    onChange: (v: T) => void;
    compact?: boolean;
}) {
    return (
        <div
            className="grid gap-1 p-0.75 rounded-xl"
            style={{
                background: "rgba(118, 118, 128, 0.09)",
                gridTemplateColumns: `repeat(${options.length}, 1fr)`,
            }}
        >
            {options.map(({ id, label }) => {
                const active = value === id;
                return (
                    <button
                        key={id}
                        type="button"
                        onClick={() => onChange(id)}
                        className={`rounded-lg tracking-[-0.005em] transition-colors ${
                            compact ? "h-6 text-[12px]" : "h-7 text-[13px]"
                        } ${active ? "font-medium" : ""}`}
                        style={{
                            background: active ? "var(--onebox-card)" : "transparent",
                            color: active
                                ? "var(--onebox-label)"
                                : "var(--onebox-label-secondary)",
                            boxShadow: active ? "var(--onebox-shadow-card)" : "none",
                        }}
                    >
                        {label}
                    </button>
                );
            })}
        </div>
    );
}

