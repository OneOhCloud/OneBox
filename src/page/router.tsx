import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Pencil, Plus, QuestionCircle, X, XCircleFill } from "react-bootstrap-icons";
import { toast } from "sonner";
import { IOSTextField } from "../components/common/ios-text-field";
import { HelpModal } from "../components/router-settings/help-modal";
import {
    RULE_ACTIONS,
    RULE_KINDS,
    kindsInClass,
    type RuleAction,
    type RuleKind,
} from "../config/merger/custom-rules";
import { getCustomRuleSet, setCustomRuleSet } from "../single/store";
import { t } from "../utils/helper";
import {
    ACTION_COLOR,
    ACTION_TINT,
    ActionBadge,
    KIND_META,
    KindChip,
} from "../components/router-settings/rule-badges";
import {
    addRule,
    emptyRuleSets,
    flattenRules,
    removeRule,
    updateRule,
    type FlatRule,
    type RuleSets,
} from "./router-rules";

// Above this many rules, reveal the search field.
const SEARCH_THRESHOLD = 12;

export default function RouterSettings() {
    const [sets, setSets] = useState<RuleSets>(emptyRuleSets);
    const [showHelp, setShowHelp] = useState(false);
    const [search, setSearch] = useState("");
    const [justChanged, setJustChanged] = useState<string | null>(null);

    // Add composer — its own state; action/kind persist across adds for batch entry.
    const [addOpen, setAddOpen] = useState(false);
    const [action, setAction] = useState<RuleAction>("direct");
    const [kind, setKind] = useState<RuleKind>("domain");
    const [input, setInput] = useState("");

    // Edit composer — its own state; seeded from the row being edited.
    const [editOpen, setEditOpen] = useState(false);
    const [editOriginal, setEditOriginal] = useState<FlatRule | null>(null);
    const [editAction, setEditAction] = useState<RuleAction>("direct");
    const [editKind, setEditKind] = useState<RuleKind>("domain");
    const [editValue, setEditValue] = useState("");

    useEffect(() => {
        const load = async () => {
            try {
                const [direct, reject, proxy] = await Promise.all([
                    getCustomRuleSet("direct"),
                    getCustomRuleSet("reject"),
                    getCustomRuleSet("proxy"),
                ]);
                setSets({ direct, reject, proxy });
            } catch {
                toast.error(t("load_rules_failed", "Failed to load rules"));
            }
        };
        load();
    }, []);

    const allRules = useMemo(() => flattenRules(sets), [sets]);
    const visibleRules = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return allRules;
        return allRules.filter((r) => r.value.toLowerCase().includes(q));
    }, [allRules, search]);

    // Persist the next sets and write every affected action's store key. Edit
    // can move a rule between two actions, so callers pass all touched actions.
    const persist = async (next: RuleSets, actions: RuleAction[]) => {
        setSets(next);
        await Promise.all([...new Set(actions)].map((a) => setCustomRuleSet(a, next[a])));
    };

    const handleAdd = async () => {
        // A flat model makes bulk import free: split on newlines / commas so a
        // pasted list becomes one rule per token, all sharing the explicit
        // action + kind (no error-prone auto-detection).
        const tokens = input
            .split(/[\n,]+/)
            .map((s) => s.trim())
            .filter(Boolean);
        if (tokens.length === 0) {
            toast.error(t("input_empty", "Input cannot be empty"));
            return;
        }

        let next = sets;
        let added = 0;
        let dupes = 0;
        let conflict = false;
        for (const token of tokens) {
            const out = addRule(next, action, kind, token);
            if (!out.sets) {
                dupes++;
                continue;
            }
            next = out.sets;
            added++;
            if (out.conflictAction) conflict = true;
        }

        if (added === 0) {
            toast.error(t("rule_exists", "Rule already exists"));
            return;
        }

        await persist(next, [action]);
        setInput("");
        setJustChanged(`${action}-${kind}`);

        if (added > 1 || dupes > 0) {
            toast.success(t("rules_bulk_added", { added, dupes }));
        } else if (conflict) {
            toast.success(t("rule_conflict_other_action"));
        } else {
            toast.success(t("add_success", "Added successfully"));
        }
    };

    const handleRemove = (rule: FlatRule) => {
        const next = removeRule(sets, rule.action, rule.kind, rule.value);
        persist(next, [rule.action]);
        toast.success(t("delete_success", "Deleted successfully"));
    };

    const openEdit = (rule: FlatRule) => {
        setEditOriginal(rule);
        setEditAction(rule.action);
        setEditKind(rule.kind);
        setEditValue(rule.value);
        setAddOpen(false);
        setEditOpen(true);
    };

    const handleEditSave = async () => {
        if (!editOriginal) return;
        const value = editValue.trim();
        if (!value) {
            toast.error(t("input_empty", "Input cannot be empty"));
            return;
        }
        const out = updateRule(sets, editOriginal, editAction, editKind, value);
        if (out.unchanged) {
            setEditOpen(false);
            return;
        }
        if (!out.sets) {
            toast.error(t("rule_exists", "Rule already exists"));
            return;
        }
        await persist(out.sets, [editOriginal.action, editAction]);
        setJustChanged(`${editAction}-${editKind}`);
        toast.success(
            out.conflictAction
                ? t("rule_conflict_other_action")
                : t("save_success", "Saved successfully"),
        );
        setEditOpen(false);
    };

    const openAdd = () => {
        setEditOpen(false);
        setAddOpen(true);
    };

    return (
        <div className="onebox-scrollpage">
            <HelpModal isOpen={showHelp} onClose={() => setShowHelp(false)} />

            <div className="onebox-page-inner !pt-3 pb-6">
                {/* List header — count + help. */}
                <div className="flex items-center justify-between mb-1.5 px-1">
                    <h3
                        className="text-[11px] font-semibold uppercase tracking-[0.04em]"
                        style={{ color: "var(--onebox-label-secondary)" }}
                    >
                        {t("rules_count_label", "Rules")}
                        {` · ${allRules.length}`}
                    </h3>
                    <button
                        type="button"
                        onClick={() => setShowHelp(true)}
                        className="p-1 rounded-full transition-colors active:bg-[rgba(0,122,255,0.08)]"
                        aria-label={t("rule_info_title", "Rule Information")}
                    >
                        <QuestionCircle
                            size={13}
                            style={{ color: "var(--onebox-label-secondary)" }}
                        />
                    </button>
                </div>

                {allRules.length > SEARCH_THRESHOLD && (
                    <div className="mb-2">
                        <IOSTextField
                            value={search}
                            onChange={setSearch}
                            placeholder={t("filter_placeholder", "Filter keyword...")}
                            compact
                            monospace
                        />
                    </div>
                )}

                {/* The list always ends with an "add rule" row — the only add entry. */}
                <div className="onebox-grouped-card">
                    {visibleRules.map((rule) => (
                        <RuleRow
                            key={`${rule.action}-${rule.kind}-${rule.value}`}
                            rule={rule}
                            fresh={justChanged === `${rule.action}-${rule.kind}`}
                            onEdit={() => openEdit(rule)}
                            onRemove={() => handleRemove(rule)}
                        />
                    ))}
                    {search.trim().length > 0 && visibleRules.length === 0 && (
                        <div
                            className="px-3 py-3 text-center text-[13px]"
                            style={{ color: "var(--onebox-label-tertiary)" }}
                        >
                            {t("no_matching_rules", "No matching rules")}
                        </div>
                    )}
                    <AddRuleRow onClick={openAdd} />
                </div>

                <p
                    className="px-1 mt-3 text-[11px] leading-snug"
                    style={{ color: "var(--onebox-label-secondary)" }}
                >
                    {t(
                        "rules_effective_info",
                        "Rules take effect after restarting the VPN",
                    )}
                </p>
            </div>

            <AddRuleSheet
                open={addOpen}
                onClose={() => setAddOpen(false)}
                action={action}
                onActionChange={setAction}
                kind={kind}
                onKindChange={setKind}
                input={input}
                onInputChange={setInput}
                onAdd={handleAdd}
            />
            <EditRuleSheet
                open={editOpen}
                onClose={() => setEditOpen(false)}
                original={editOriginal}
                action={editAction}
                onActionChange={setEditAction}
                kind={editKind}
                onKindChange={setEditKind}
                value={editValue}
                onValueChange={setEditValue}
                onSave={handleEditSave}
            />
        </div>
    );
}

function RuleRow({
    rule,
    fresh,
    onEdit,
    onRemove,
}: {
    rule: FlatRule;
    fresh: boolean;
    onEdit: () => void;
    onRemove: () => void;
}) {
    return (
        <motion.div
            className="group flex items-center gap-2 px-3 py-2.5"
            initial={fresh ? { backgroundColor: ACTION_TINT[rule.action] } : false}
            animate={{ backgroundColor: "rgba(0,0,0,0)" }}
            transition={{ duration: 1.2, ease: "easeOut" }}
        >
            <ActionBadge action={rule.action} />
            <KindChip kind={rule.kind} />
            <span
                className="flex-1 min-w-0 text-[13px] truncate"
                style={{
                    color: "var(--onebox-label)",
                    fontFamily: '"SF Mono", ui-monospace, "Menlo", monospace',
                }}
            >
                {rule.value}
            </span>
            {/* Edit and delete — both neutral gray (delete never red, so it isn't
                read as a reject signal). */}
            <button
                type="button"
                onClick={onEdit}
                className="shrink-0 p-1 rounded-full transition-colors active:bg-[rgba(60,60,67,0.08)]"
                aria-label={t("edit")}
            >
                <Pencil
                    size={13}
                    className="opacity-55 hover:opacity-95"
                    style={{ color: "rgba(60, 60, 67, 0.55)" }}
                />
            </button>
            <button
                type="button"
                onClick={onRemove}
                className="shrink-0 p-1 rounded-full transition-colors active:bg-[rgba(255,59,48,0.08)]"
                aria-label={t("delete")}
            >
                <XCircleFill
                    size={16}
                    className="opacity-55 hover:opacity-95"
                    style={{ color: "rgba(60, 60, 67, 0.55)" }}
                />
            </button>
        </motion.div>
    );
}

/** The add entry — the last row of the list, styled to match a rule row. */
function AddRuleRow({ onClick }: { onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 transition-colors active:bg-[rgba(0,122,255,0.06)]"
        >
            <span
                className="inline-flex items-center justify-center size-5 rounded-md shrink-0"
                style={{ background: "rgba(0, 122, 255, 0.12)", color: "var(--onebox-blue)" }}
            >
                <Plus size={14} />
            </span>
            <span
                className="text-[13px] font-medium"
                style={{ color: "var(--onebox-blue)" }}
            >
                {t("add_rule", "Add Rule")}
            </span>
        </button>
    );
}

// ── Add composer ──────────────────────────────────────────────────────────
// Owns: all-action picker, all-kind picker, bulk-paste input, add-and-stay.
function AddRuleSheet({
    open,
    onClose,
    action,
    onActionChange,
    kind,
    onKindChange,
    input,
    onInputChange,
    onAdd,
}: {
    open: boolean;
    onClose: () => void;
    action: RuleAction;
    onActionChange: (a: RuleAction) => void;
    kind: RuleKind;
    onKindChange: (k: RuleKind) => void;
    input: string;
    onInputChange: (v: string) => void;
    onAdd: () => void;
}) {
    return (
        <BottomSheet open={open} onClose={onClose} title={t("add_rule", "Add Rule")}>
            <div className="px-4 pb-4 space-y-3">
                <div>
                    <Label text={t("rule_action", "Action")} />
                    <ActionSegmented value={action} onChange={onActionChange} />
                </div>

                <div>
                    <Label text={t("rule_match", "Match")} />
                    <Segmented
                        options={RULE_KINDS.map((k) => ({ id: k, label: t(`kind_${k}`) }))}
                        value={kind}
                        onChange={(v) => onKindChange(v as RuleKind)}
                    />
                </div>

                <div className="flex gap-2">
                    <IOSTextField
                        className="flex-1"
                        value={input}
                        onChange={onInputChange}
                        placeholder={KIND_META[kind].placeholder}
                        onSubmit={onAdd}
                        monospace
                        autoFocus
                    />
                    <button
                        type="button"
                        onClick={onAdd}
                        disabled={!input.trim()}
                        className="shrink-0 size-10 rounded-xl flex items-center justify-center transition-all active:brightness-95 disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ background: ACTION_COLOR[action], color: "#FFFFFF" }}
                        aria-label={t("add")}
                    >
                        <Plus size={20} />
                    </button>
                </div>

                <PreviewLine action={action} kind={kind} value={input} />
                <PriorityHint />
            </div>
        </BottomSheet>
    );
}

// ── Edit composer ─────────────────────────────────────────────────────────
// Owns: seeded fields, class-constrained kind (domain↔suffix; ip_cidr locked),
// single-value replace via Save.
function EditRuleSheet({
    open,
    onClose,
    original,
    action,
    onActionChange,
    kind,
    onKindChange,
    value,
    onValueChange,
    onSave,
}: {
    open: boolean;
    onClose: () => void;
    original: FlatRule | null;
    action: RuleAction;
    onActionChange: (a: RuleAction) => void;
    kind: RuleKind;
    onKindChange: (k: RuleKind) => void;
    value: string;
    onValueChange: (v: string) => void;
    onSave: () => void;
}) {
    // Only kinds in the same class as the original are offered; a single-member
    // class (ip_cidr) renders as a locked chip — no cross-class conversion.
    const kindOptions = original ? kindsInClass(original.kind) : RULE_KINDS;

    return (
        <BottomSheet open={open} onClose={onClose} title={t("edit_rule", "Edit Rule")}>
            <div className="px-4 pb-4 space-y-3">
                <div>
                    <Label text={t("rule_action", "Action")} />
                    <ActionSegmented value={action} onChange={onActionChange} />
                </div>

                <div>
                    <Label text={t("rule_match", "Match")} />
                    {kindOptions.length > 1 ? (
                        <Segmented
                            options={kindOptions.map((k) => ({ id: k, label: t(`kind_${k}`) }))}
                            value={kind}
                            onChange={(v) => onKindChange(v as RuleKind)}
                        />
                    ) : (
                        <LockedKindChip kind={kind} />
                    )}
                </div>

                <div className="flex gap-2">
                    <IOSTextField
                        className="flex-1"
                        value={value}
                        onChange={onValueChange}
                        placeholder={KIND_META[kind].placeholder}
                        onSubmit={onSave}
                        monospace
                        autoFocus
                    />
                    <button
                        type="button"
                        onClick={onSave}
                        disabled={!value.trim()}
                        className="shrink-0 h-10 px-4 rounded-xl flex items-center justify-center text-[14px] font-semibold transition-all active:brightness-95 disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ background: ACTION_COLOR[action], color: "#FFFFFF" }}
                    >
                        {t("save", "Save")}
                    </button>
                </div>

                <PreviewLine action={action} kind={kind} value={value} />
                <PriorityHint />
            </div>
        </BottomSheet>
    );
}

// ── Shared presentational shell + atoms ───────────────────────────────────

/** Bottom-sheet chrome: backdrop, slide-up panel, grabber, title, close. */
function BottomSheet({
    open,
    onClose,
    title,
    children,
}: {
    open: boolean;
    onClose: () => void;
    title: string;
    children: ReactNode;
}) {
    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    className="fixed inset-0 z-50 flex items-end justify-center"
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
                        className="relative w-full max-w-[480px] rounded-t-[16px] overflow-hidden"
                        style={{
                            background: "var(--onebox-card)",
                            boxShadow: "0 -8px 32px -8px rgba(15, 23, 42, 0.28)",
                            paddingBottom: "env(safe-area-inset-bottom)",
                        }}
                        initial={{ y: "100%" }}
                        animate={{ y: 0 }}
                        exit={{ y: "100%" }}
                        transition={{ duration: 0.26, ease: [0.32, 0.72, 0, 1] }}
                    >
                        <div className="relative flex items-center justify-center px-4 pt-3.5 pb-2">
                            <span
                                className="absolute top-2 left-1/2 -translate-x-1/2 w-9 h-1 rounded-full"
                                style={{ background: "rgba(60, 60, 67, 0.2)" }}
                            />
                            <h3
                                className="text-[15px] font-semibold tracking-[-0.01em]"
                                style={{ color: "var(--onebox-label)" }}
                            >
                                {title}
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
                        {children}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

/** Action picker — active label tints to the action color. */
function ActionSegmented({
    value,
    onChange,
}: {
    value: RuleAction;
    onChange: (a: RuleAction) => void;
}) {
    return (
        <Segmented
            options={RULE_ACTIONS.map((a) => ({ id: a, label: t(`action_${a}`) }))}
            value={value}
            onChange={(v) => onChange(v as RuleAction)}
            activeColor={(id) => ACTION_COLOR[id as RuleAction]}
        />
    );
}

/** Live preview — reads back what this rule will do, in the action color. */
function PreviewLine({
    action,
    kind,
    value,
}: {
    action: RuleAction;
    kind: RuleKind;
    value: string;
}) {
    return (
        <p
            className="px-1 text-[12px] leading-snug"
            style={{ color: ACTION_COLOR[action] }}
        >
            {`${t(`action_${action}`)}: ${t(`preview_${kind}`, { v: value.trim() || KIND_META[kind].placeholder })}`}
        </p>
    );
}

/** First-match-wins priority reminder, shared by both composers. */
function PriorityHint() {
    return (
        <p
            className="px-1 text-[11px] leading-snug"
            style={{ color: "var(--onebox-label-tertiary)" }}
        >
            {t("rule_priority_hint")}
        </p>
    );
}

/** A non-interactive kind chip — used when the kind can't change (ip_cidr). */
function LockedKindChip({ kind }: { kind: RuleKind }) {
    return (
        <div
            className="h-7 px-3 rounded-xl inline-flex items-center gap-1.5 text-[13px]"
            style={{ background: "var(--onebox-fill)", color: "var(--onebox-label-secondary)" }}
        >
            <span style={{ fontFamily: '"SF Mono", ui-monospace, "Menlo", monospace' }}>
                {KIND_META[kind].glyph} {KIND_META[kind].abbr}
            </span>
            <span className="opacity-50">·</span>
            <span>{t(`kind_${kind}`)}</span>
        </div>
    );
}

function Label({ text }: { text: string }) {
    return (
        <p
            className="text-[11px] font-semibold uppercase tracking-[0.04em] mb-1.5 px-0.5"
            style={{ color: "var(--onebox-label-secondary)" }}
        >
            {text}
        </p>
    );
}

/**
 * iOS-style segmented control. Single-row track with a sliding white pill
 * behind the active option. `activeColor` optionally tints the active
 * option's label (used to teach the action→color map at choice time).
 */
function Segmented<T extends string>({
    options,
    value,
    onChange,
    activeColor,
}: {
    options: { id: T; label: string }[];
    value: T;
    onChange: (v: T) => void;
    activeColor?: (id: T) => string | undefined;
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
                const tint = active ? activeColor?.(id) : undefined;
                return (
                    <button
                        key={id}
                        type="button"
                        onClick={() => onChange(id)}
                        className={`h-7 text-[13px] rounded-lg tracking-[-0.005em] transition-colors ${active ? "font-semibold" : ""}`}
                        style={{
                            background: active ? "var(--onebox-card)" : "transparent",
                            color: tint
                                ? tint
                                : active
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
