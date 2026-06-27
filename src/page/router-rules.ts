// Pure list-shaping logic for the rules page, kept out of the React
// component so it can be unit-tested without a DOM.
//
// The store holds one RuleSet per action. The page flattens all three into
// a single sorted list of FlatRule rows; add/remove map a row back to its
// (action, kind) array and mutate BY VALUE — never by display index, since
// the flat list is a sorted derived view whose indices don't line up with
// the underlying arrays.

import {
    type RuleAction,
    type RuleKind,
    type RuleSet,
    RULE_ACTIONS,
    RULE_KINDS,
    emptyRuleSet,
} from '../config/merger/custom-rules';

export type RuleSets = Record<RuleAction, RuleSet>;

export interface FlatRule {
    action: RuleAction;
    kind: RuleKind;
    value: string;
}

export function emptyRuleSets(): RuleSets {
    return { direct: emptyRuleSet(), reject: emptyRuleSet(), proxy: emptyRuleSet() };
}

/**
 * Flatten all three action sets into one list, ordered action → kind → value.
 * Action and kind order come straight from RULE_ACTIONS / RULE_KINDS (the loop
 * nesting); only the value order within a group needs an explicit sort.
 */
export function flattenRules(sets: RuleSets): FlatRule[] {
    const out: FlatRule[] = [];
    for (const action of RULE_ACTIONS) {
        for (const kind of RULE_KINDS) {
            for (const value of [...sets[action][kind]].sort((a, b) => a.localeCompare(b))) {
                out.push({ action, kind, value });
            }
        }
    }
    return out;
}

export interface AddOutcome {
    /** Next sets if the value was added; null if it already existed for this (action, kind). */
    sets: RuleSets | null;
    /** A different action that already holds this value, if any (soft conflict). */
    conflictAction: RuleAction | null;
}

/**
 * Add (action, kind, value) to a copy of `sets`. Returns sets=null when the
 * exact (action, kind, value) triple already exists (caller shows a toast
 * and keeps the input). conflictAction flags the same value living under a
 * different action — sing-box is first-match-wins, so this is worth warning
 * about but not blocking.
 */
export function addRule(
    sets: RuleSets,
    action: RuleAction,
    kind: RuleKind,
    value: string,
): AddOutcome {
    if (sets[action][kind].includes(value)) {
        return { sets: null, conflictAction: null };
    }

    const conflictAction =
        RULE_ACTIONS.find(
            (a) =>
                a !== action &&
                (sets[a].domain.includes(value) ||
                    sets[a].domain_suffix.includes(value) ||
                    sets[a].ip_cidr.includes(value)),
        ) ?? null;

    const next = structuredClone(sets);
    next[action][kind].push(value);
    return { sets: next, conflictAction };
}

export interface EditOutcome {
    /** Next sets; null when the edited triple collides with a different existing rule. */
    sets: RuleSets | null;
    /** A different action that already holds the new value, if any (soft conflict). */
    conflictAction: RuleAction | null;
    /** True when nothing changed — caller can close silently. */
    unchanged: boolean;
}

/**
 * Replace `original` with (action, kind, value). Composed from removeRule +
 * addRule: drop the old triple, then add the new one. Because the old triple
 * is removed first, re-adding the same value under the same (action, kind) is
 * never seen as a duplicate — only a collision with a *different* existing
 * rule yields sets=null. The kind-class constraint is enforced by the caller
 * (the edit UI only offers same-class kinds), not here.
 */
export function updateRule(
    sets: RuleSets,
    original: FlatRule,
    action: RuleAction,
    kind: RuleKind,
    value: string,
): EditOutcome {
    if (action === original.action && kind === original.kind && value === original.value) {
        return { sets, conflictAction: null, unchanged: true };
    }

    const removed = removeRule(sets, original.action, original.kind, original.value);
    const out = addRule(removed, action, kind, value);
    return { sets: out.sets, conflictAction: out.conflictAction, unchanged: false };
}

/** Remove a row by value (not by display index). Returns a new RuleSets. */
export function removeRule(
    sets: RuleSets,
    action: RuleAction,
    kind: RuleKind,
    value: string,
): RuleSets {
    const next = structuredClone(sets);
    next[action][kind] = next[action][kind].filter((v) => v !== value);
    return next;
}
