// Mirror of `src-tauri/src/vpn/state_machine.rs::VpnState`. Keep in sync.

export type VpnStateKind = 'idle' | 'starting' | 'running' | 'stopping' | 'failed';

export type VpnState =
    | { kind: 'idle'; epoch: number }
    | { kind: 'starting'; since: number; epoch: number; mode: string }
    | { kind: 'running'; since: number; epoch: number; mode: string }
    | { kind: 'stopping'; since: number; epoch: number }
    | { kind: 'failed'; reason: string; at: number; epoch: number };

export const VPN_STATE_EVENT = 'vpn-state';

export const IDLE_STATE: VpnState = { kind: 'idle', epoch: 0 };
