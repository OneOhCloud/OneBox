export function canReuseGeneratedTemplateSnapshot(
    snapshot: string,
    expectedBranch: string,
    expectedSingBoxVersion: string,
): boolean {
    const branch = /\bbranch:\s*'([^']+)'/.exec(snapshot)?.[1];
    const singBoxVersion = /\bsingBoxVersion:\s*'([^']+)'/.exec(snapshot)?.[1];
    return branch === expectedBranch && singBoxVersion === expectedSingBoxVersion;
}
