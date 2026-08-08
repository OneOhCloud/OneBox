export interface SingBoxVersion {
    major: number;
    minor: number;
    patch: number;
    prerelease?: string;
}

const SING_BOX_VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*))?$/;

export function parseSingBoxVersion(version: string): SingBoxVersion {
    const match = SING_BOX_VERSION_PATTERN.exec(version);
    if (!match) {
        throw new Error(`invalid sing-box version "${version}"`);
    }

    const parsed: SingBoxVersion = {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
    };
    if (match[4]) parsed.prerelease = match[4];
    return parsed;
}

export function resolveSingBoxTemplateVersion(version: string): string {
    const { major, minor, patch } = parseSingBoxVersion(version);
    if (major === 1 && minor === 14) return '1.14';
    if (major === 1 && minor === 13 && patch >= 8) return '1.13.8';
    if (major === 1 && minor === 13) return '1.13';
    if (major === 1 && minor === 12) return '1.12';
    throw new Error(
        `unsupported sing-box version ${version} — add a template mapping in src/utils/sing-box-version.ts`,
    );
}
