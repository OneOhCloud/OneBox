import { describe, expect, it } from 'vitest';
import { parseSingBoxVersion, resolveSingBoxTemplateVersion } from '../utils/sing-box-version';

describe('sing-box version', () => {
    it('parses a prerelease without losing its patch number', () => {
        expect(parseSingBoxVersion('v1.14.0-beta.10')).toEqual({
            major: 1,
            minor: 14,
            patch: 0,
            prerelease: 'beta.10',
        });
    });

    it.each([
        ['v1.14.0', '1.14'],
        ['v1.14.0-beta.10', '1.14'],
        ['v1.13.15', '1.13.8'],
        ['v1.13.7', '1.13'],
        ['v1.12.9', '1.12'],
    ])('maps %s to conf/%s', (version, templateVersion) => {
        expect(resolveSingBoxTemplateVersion(version)).toBe(templateVersion);
    });

    it.each(['1.14', 'v1.14.0-', 'v1.14.0_beta.10', 'latest'])(
        'rejects malformed version %s',
        (version) => {
            expect(() => parseSingBoxVersion(version)).toThrow(`invalid sing-box version "${version}"`);
        },
    );
});
