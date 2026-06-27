import { describe, expect, it } from 'vitest';
import {
    ACTION_ANCHOR,
    injectCustomRules,
    isRuleSetEmpty,
    kindClass,
    kindsInClass,
    type RuleSet,
} from '../config/merger/custom-rules';
import {
    addRule,
    emptyRuleSets,
    flattenRules,
    removeRule,
    updateRule,
    type FlatRule,
    type RuleSets,
} from '../page/router-rules';

function set(partial: Partial<RuleSet>): RuleSet {
    return { domain: [], domain_suffix: [], ip_cidr: [], ...partial };
}

/** A minimal route config with all three anchors, mirroring conf-template. */
function configWithAnchors() {
    return {
        route: {
            rules: [
                { action: 'sniff' },
                { domain: [ACTION_ANCHOR.reject], domain_suffix: [], ip_cidr: [], action: 'reject' },
                { domain: [ACTION_ANCHOR.direct], domain_suffix: [], ip_cidr: [], outbound: 'direct' },
                { domain: [ACTION_ANCHOR.proxy], domain_suffix: [], ip_cidr: [], outbound: 'ExitGateway' },
            ],
        },
    };
}

function ruleOf(config: any, anchor: string) {
    return config.route.rules.find((r: any) => Array.isArray(r.domain) && r.domain.includes(anchor));
}

describe('injectCustomRules', () => {
    it('injects each action set into its own anchor rule', () => {
        const config = configWithAnchors();
        injectCustomRules(config, {
            direct: set({ domain: ['intranet.local'], ip_cidr: ['10.0.0.0/8'] }),
            reject: set({ domain: ['ads.tracker.com'] }),
            proxy: set({ domain_suffix: ['.openai.com'] }),
        });

        const direct = ruleOf(config, ACTION_ANCHOR.direct);
        expect(direct.domain).toEqual([ACTION_ANCHOR.direct, 'intranet.local']);
        expect(direct.ip_cidr).toEqual(['10.0.0.0/8']);

        expect(ruleOf(config, ACTION_ANCHOR.reject).domain).toContain('ads.tracker.com');
        expect(ruleOf(config, ACTION_ANCHOR.proxy).domain_suffix).toEqual(['.openai.com']);
    });

    it('keeps the reject rule action intact (does not turn it into an outbound)', () => {
        const config = configWithAnchors();
        injectCustomRules(config, {
            direct: set({}),
            reject: set({ domain: ['ads.tracker.com'] }),
            proxy: set({}),
        });
        const reject = ruleOf(config, ACTION_ANCHOR.reject);
        expect(reject.action).toBe('reject');
        expect(reject.outbound).toBeUndefined();
    });

    it('skips an action whose anchor is missing (stale snapshot) without throwing', () => {
        const config = {
            route: {
                rules: [
                    { domain: [ACTION_ANCHOR.direct], domain_suffix: [], ip_cidr: [], outbound: 'direct' },
                    { domain: [ACTION_ANCHOR.proxy], domain_suffix: [], ip_cidr: [], outbound: 'ExitGateway' },
                ],
            },
        };
        expect(() =>
            injectCustomRules(config, {
                direct: set({}),
                reject: set({ domain: ['ads.tracker.com'] }),
                proxy: set({}),
            }),
        ).not.toThrow();
        // No reject anchor to receive it, and direct/proxy stay untouched.
        expect(config.route.rules).toHaveLength(2);
        expect(ruleOf(config, ACTION_ANCHOR.direct).domain).toEqual([ACTION_ANCHOR.direct]);
    });

    it('does nothing for empty sets and tolerates a config without route.rules', () => {
        const config = configWithAnchors();
        injectCustomRules(config, { direct: set({}), reject: set({}), proxy: set({}) });
        expect(ruleOf(config, ACTION_ANCHOR.direct).domain).toEqual([ACTION_ANCHOR.direct]);

        expect(() => injectCustomRules({}, emptyRuleSets())).not.toThrow();
    });
});

describe('isRuleSetEmpty', () => {
    it('is true only when all three arrays are empty', () => {
        expect(isRuleSetEmpty(set({}))).toBe(true);
        expect(isRuleSetEmpty(set({ ip_cidr: ['10.0.0.0/8'] }))).toBe(false);
    });
});

describe('router-rules list helpers', () => {
    function seeded(): RuleSets {
        const s = emptyRuleSets();
        s.proxy.domain_suffix = ['.openai.com'];
        s.proxy.domain = ['github.com'];
        s.reject.ip_cidr = ['10.0.0.0/8'];
        s.direct.domain = ['intranet.local'];
        return s;
    }

    it('flattens and sorts by action → kind → value (priority order)', () => {
        const flat = flattenRules(seeded());
        expect(flat.map((r) => `${r.action}/${r.kind}/${r.value}`)).toEqual([
            'reject/ip_cidr/10.0.0.0/8',
            'direct/domain/intranet.local',
            'proxy/domain/github.com',
            'proxy/domain_suffix/.openai.com',
        ]);
    });

    it('addRule appends and reports no conflict for a fresh value', () => {
        const out = addRule(emptyRuleSets(), 'direct', 'domain', 'example.com');
        expect(out.sets?.direct.domain).toEqual(['example.com']);
        expect(out.conflictAction).toBeNull();
    });

    it('addRule rejects an exact duplicate triple (sets=null)', () => {
        const out = addRule(seeded(), 'proxy', 'domain', 'github.com');
        expect(out.sets).toBeNull();
    });

    it('addRule flags a cross-action conflict but still adds', () => {
        const s = seeded(); // github.com is under proxy/domain
        const out = addRule(s, 'direct', 'domain', 'github.com');
        expect(out.sets?.direct.domain).toContain('github.com');
        expect(out.conflictAction).toBe('proxy');
    });

    it('addRule does not mutate the input sets', () => {
        const s = emptyRuleSets();
        addRule(s, 'direct', 'domain', 'example.com');
        expect(s.direct.domain).toEqual([]);
    });

    it('removeRule deletes by value, not by display index', () => {
        const s = seeded();
        const next = removeRule(s, 'proxy', 'domain', 'github.com');
        expect(next.proxy.domain).toEqual([]);
        expect(next.proxy.domain_suffix).toEqual(['.openai.com']);
        // original untouched
        expect(s.proxy.domain).toEqual(['github.com']);
    });
});

describe('kind class', () => {
    it('groups domain and domain_suffix together, ip_cidr alone', () => {
        expect(kindClass('domain')).toBe('domain');
        expect(kindClass('domain_suffix')).toBe('domain');
        expect(kindClass('ip_cidr')).toBe('ip');
    });

    it('kindsInClass returns interchangeable kinds for editing', () => {
        expect(kindsInClass('domain')).toEqual(['domain', 'domain_suffix']);
        expect(kindsInClass('domain_suffix')).toEqual(['domain', 'domain_suffix']);
        expect(kindsInClass('ip_cidr')).toEqual(['ip_cidr']);
    });
});

describe('updateRule', () => {
    function seeded(): RuleSets {
        const s = emptyRuleSets();
        s.direct.domain = ['intranet.local'];
        s.proxy.domain = ['github.com'];
        s.reject.ip_cidr = ['10.0.0.0/8'];
        return s;
    }
    const at = (action: FlatRule['action'], kind: FlatRule['kind'], value: string): FlatRule => ({ action, kind, value });

    it('no-ops when the triple is unchanged', () => {
        const out = updateRule(seeded(), at('direct', 'domain', 'intranet.local'), 'direct', 'domain', 'intranet.local');
        expect(out.unchanged).toBe(true);
        expect(out.sets).not.toBeNull();
    });

    it('moves a rule between action sets when only the action changes', () => {
        const out = updateRule(seeded(), at('direct', 'domain', 'intranet.local'), 'reject', 'domain', 'intranet.local');
        expect(out.unchanged).toBe(false);
        expect(out.sets?.direct.domain).toEqual([]);
        expect(out.sets?.reject.domain).toEqual(['intranet.local']);
    });

    it('changes kind within the domain class and edits the value', () => {
        const out = updateRule(seeded(), at('direct', 'domain', 'intranet.local'), 'direct', 'domain_suffix', '.lan');
        expect(out.sets?.direct.domain).toEqual([]);
        expect(out.sets?.direct.domain_suffix).toEqual(['.lan']);
    });

    it('rejects an edit that collides with a different existing rule', () => {
        // proxy/github.com already exists; editing intranet.local into it collides.
        const out = updateRule(seeded(), at('direct', 'domain', 'intranet.local'), 'proxy', 'domain', 'github.com');
        expect(out.sets).toBeNull();
    });

    it('flags a cross-action conflict but still applies the edit', () => {
        // reject/10.0.0.0/8 exists; add a direct CIDR for it via edit of another rule.
        const s = seeded();
        s.direct.ip_cidr = ['192.168.0.0/16'];
        const out = updateRule(s, at('direct', 'ip_cidr', '192.168.0.0/16'), 'direct', 'ip_cidr', '10.0.0.0/8');
        expect(out.sets?.direct.ip_cidr).toContain('10.0.0.0/8');
        expect(out.conflictAction).toBe('reject');
    });

    it('does not mutate the input sets', () => {
        const s = seeded();
        updateRule(s, at('direct', 'domain', 'intranet.local'), 'proxy', 'domain', 'intranet.local');
        expect(s.direct.domain).toEqual(['intranet.local']);
    });
});
