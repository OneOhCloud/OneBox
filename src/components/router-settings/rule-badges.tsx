import type { RuleAction, RuleKind } from "../../config/merger/custom-rules";
import { t } from "../../utils/helper";

// Color encodes ACTION, everywhere. Kind never carries hue — it shows as a
// neutral monospace glyph-chip, so each row has exactly one color source. The
// action hues reference the theme tokens (which adapt to dark mode); tint is
// the same hue at 12% alpha for badges/pulses (no theme token exists for it).
export const ACTION_COLOR: Record<RuleAction, string> = {
    direct: "var(--onebox-green)", // bypass
    reject: "var(--onebox-red)", // block
    proxy: "var(--onebox-blue)", // tunnel
};
export const ACTION_TINT: Record<RuleAction, string> = {
    direct: "rgba(52, 199, 89, 0.12)",
    reject: "rgba(255, 59, 48, 0.12)",
    proxy: "rgba(0, 122, 255, 0.12)",
};

// Everything about a match kind in one row: `glyph` doubles as a syntax hint,
// `abbr` names it, `placeholder` is the example input. i18n keys are derived
// directly — t(`kind_${kind}`) / t(`preview_${kind}`) — so no lookup map.
export const KIND_META: Record<RuleKind, { glyph: string; abbr: string; placeholder: string }> = {
    domain: { glyph: "=", abbr: "DOM", placeholder: "example.com" },
    domain_suffix: { glyph: "*.", abbr: "SFX", placeholder: ".example.com" },
    ip_cidr: { glyph: "/", abbr: "CIDR", placeholder: "192.168.1.0/24" },
};

const MONO = '"SF Mono", ui-monospace, "Menlo", monospace';

/** The action pill — the single color source of a rule row. Shared by the
 *  list rows and the help legend so the two can never visually drift. */
export function ActionBadge({ action }: { action: RuleAction }) {
    return (
        <span
            className="inline-flex items-center justify-center h-5 px-1.5 rounded-md text-[11px] font-semibold shrink-0"
            style={{
                background: ACTION_TINT[action],
                color: ACTION_COLOR[action],
                minWidth: 40,
            }}
        >
            {t(`action_${action}`)}
        </span>
    );
}

/** The kind glyph-chip — neutral, monochrome. Shared by list rows and legend. */
export function KindChip({ kind }: { kind: RuleKind }) {
    return (
        <span
            className="inline-flex items-center gap-1 h-4.5 px-1.5 rounded text-[10px] font-semibold tracking-wide shrink-0"
            style={{
                background: "var(--onebox-fill)",
                color: "var(--onebox-label-secondary)",
                fontFamily: MONO,
            }}
        >
            {KIND_META[kind].glyph} {KIND_META[kind].abbr}
        </span>
    );
}
