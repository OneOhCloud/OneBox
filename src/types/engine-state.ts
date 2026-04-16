// Mirror of src-tauri/src/engine/state_machine.rs::EngineState. Keep in sync.

export type EngineStateKind = 'idle' | 'starting' | 'running' | 'stopping' | 'failed';

export type EngineState =
    | { kind: 'idle'; epoch: number }
    | { kind: 'starting'; since: number; epoch: number; mode: string }
    | { kind: 'running'; since: number; epoch: number; mode: string }
    | { kind: 'stopping'; since: number; epoch: number }
    | { kind: 'failed'; reason: string; at: number; epoch: number };

export const ENGINE_STATE_EVENT = 'engine-state';

export const IDLE_STATE: EngineState = { kind: 'idle', epoch: 0 };
