// Shared shape + injection logic for user custom routing rules.
//
// A custom rule is a (action, kind, value) triple:
//   action ∈ direct | reject | proxy   — what to do with matched traffic
//   kind   ∈ domain | domain_suffix | ip_cidr — how to match it
//
// Per action we keep one RuleSet (three string arrays). The merger injects
// each set into the matching anchor route rule emitted by conf-template.

export type RuleAction = 'direct' | 'reject' | 'proxy';
export type RuleKind = 'domain' | 'domain_suffix' | 'ip_cidr';

export interface RuleSet {
    domain: string[];
    domain_suffix: string[];
    ip_cidr: string[];
}

// Fixed iteration / display order = match priority: reject → direct → proxy.
// sing-box is first-match-wins, so reject (block) outranks direct outranks
// proxy; the list, the action pickers and the help legend all follow this.
export const RULE_ACTIONS: readonly RuleAction[] = ['reject', 'direct', 'proxy'];
export const RULE_KINDS: readonly RuleKind[] = ['domain', 'domain_suffix', 'ip_cidr'];

// A kind belongs to one class. Editing may change a kind only within its
// class: domain ↔ domain_suffix is fine (both match hostnames), but neither
// can become ip_cidr (which matches addresses). The single source of truth
// for that constraint.
export type KindClass = 'domain' | 'ip';

export function kindClass(kind: RuleKind): KindClass {
    return kind === 'ip_cidr' ? 'ip' : 'domain';
}

export function kindsInClass(kind: RuleKind): RuleKind[] {
    return RULE_KINDS.filter((k) => kindClass(k) === kindClass(kind));
}

// Anchor domains are load-bearing contracts shared with conf-template
// (CONTRACT_TAG_ANCHORS). conf-template emits one route rule per action
// carrying its anchor domain; the merger finds that rule and appends the
// user's matchers into it. The strings must match the template byte-for-byte.
export const ACTION_ANCHOR: Record<RuleAction, string> = {
    direct: 'direct-tag.oneoh.cloud',
    reject: 'reject-tag.oneoh.cloud',
    proxy: 'proxy-tag.oneoh.cloud',
};

export function emptyRuleSet(): RuleSet {
    return { domain: [], domain_suffix: [], ip_cidr: [] };
}

export function isRuleSetEmpty(set: RuleSet): boolean {
    return set.domain.length === 0
        && set.domain_suffix.length === 0
        && set.ip_cidr.length === 0;
}

/**
 * Inject user custom rules into a sing-box route config, in place.
 *
 * For each action with a non-empty set, locate the anchor route rule (the
 * one whose `domain` array contains the action's anchor domain) and append
 * the user's domain / domain_suffix / ip_cidr matchers into it.
 *
 * A missing anchor is skipped silently rather than throwing: a built-in
 * snapshot that predates an anchor (e.g. the reject anchor) lacks it, but
 * the runtime cache refreshed from the CDN carries it — so first-launch
 * offline is the only window a missing anchor affects.
 *
 * Callers pass a freshly deep-cloned config; this mutates `config.route.rules`.
 */
export function injectCustomRules(
    config: any,
    ruleSets: Record<RuleAction, RuleSet>,
): void {
    const rules = config?.route?.rules;
    if (!Array.isArray(rules)) return;

    for (const action of RULE_ACTIONS) {
        const set = ruleSets[action];
        if (!set || isRuleSetEmpty(set)) continue;

        const anchor = ACTION_ANCHOR[action];
        const rule = rules.find(
            (r: any) => Array.isArray(r.domain) && r.domain.includes(anchor),
        );
        if (!rule) continue;

        rule.domain.push(...set.domain);
        (rule.domain_suffix ??= []).push(...set.domain_suffix);
        (rule.ip_cidr ??= []).push(...set.ip_cidr);
    }
}
