import { describe, expect, it } from 'vitest';
import { canReuseGeneratedTemplateSnapshot } from '../template-snapshot';

describe('generated template snapshot', () => {
    const currentSnapshot = `
// Branch:  dev
// sing-box: v1.14.0
export const BUILD_TIME_TEMPLATE_SOURCE = {
    branch: 'dev',
    singBoxVersion: 'v1.14.0',
};`;

    it('reuses a snapshot only when its branch and sing-box version match', () => {
        expect(canReuseGeneratedTemplateSnapshot(currentSnapshot, 'dev', 'v1.14.0')).toBe(true);
        expect(canReuseGeneratedTemplateSnapshot(currentSnapshot, 'stable', 'v1.14.0')).toBe(false);
        expect(canReuseGeneratedTemplateSnapshot(currentSnapshot, 'dev', 'v1.13.15')).toBe(false);
    });

    it('rejects files without generated metadata', () => {
        expect(canReuseGeneratedTemplateSnapshot('export const template = {};', 'dev', 'v1.14.0'))
            .toBe(false);
    });
});
