export interface AutoConnectGate {
    /** The "connect on launch" setting. */
    enabled: boolean;
    /** At least one config exists to connect with. */
    hasConfig: boolean;
    /** The engine is idle — nothing else has already started it. */
    engineIdle: boolean;
    /** The cold-start pending deep link has been fetched and dispatched. */
    deepLinkChecked: boolean;
    /** An apply=1 deep link is mid-flight and will start the engine itself. */
    deepLinkApplyPending: boolean;
}

/**
 * Auto-connect fires at most once per launch, and never while the deep-link
 * apply pipeline owns the engine: that path runs its own stop → sync → start
 * and a second start would race it.
 */
export function shouldAutoConnect(gate: AutoConnectGate): boolean {
    return (
        gate.enabled &&
        gate.hasConfig &&
        gate.engineIdle &&
        gate.deepLinkChecked &&
        !gate.deepLinkApplyPending
    );
}
