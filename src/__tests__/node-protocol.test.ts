import { describe, expect, it } from 'vitest';
import { buildNodeProtocolMap, formatNodeProtocol } from '../components/home/node-protocol';

describe('node protocol helpers', () => {
    it('normalizes server proxy protocol types for display', () => {
        expect(formatNodeProtocol('VLESS')).toBe('vless');
        expect(formatNodeProtocol(' AnyTLS ')).toBe('anytls');
    });

    it('hides selector-like entries because they are not node protocols', () => {
        expect(formatNodeProtocol('Selector')).toBeUndefined();
        expect(formatNodeProtocol('URLTest')).toBeUndefined();
        expect(formatNodeProtocol('Direct')).toBeUndefined();
    });

    it('builds a protocol map for the visible node list', () => {
        const response = {
            proxies: {
                auto: { type: 'URLTest' },
                node1: { type: 'VLESS' },
                node2: { type: 'AnyTLS' },
                hidden: { type: 'TUIC' },
            },
        };

        expect(buildNodeProtocolMap(['auto', 'node1', 'node2'], response)).toEqual({
            node1: 'vless',
            node2: 'anytls',
        });
    });

    it('tolerates malformed proxy responses', () => {
        expect(buildNodeProtocolMap(['node1'], null)).toEqual({});
        expect(buildNodeProtocolMap(['node1'], { proxies: { node1: {} } })).toEqual({});
    });
});
