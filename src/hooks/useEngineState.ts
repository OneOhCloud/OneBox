import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { createContext, useContext, useEffect, useState } from 'react';
import { IDLE_STATE, ENGINE_STATE_EVENT, EngineState } from '../types/engine-state';

export function useEngineStateRoot(): EngineState {
    const [state, setState] = useState<EngineState>(IDLE_STATE);

    useEffect(() => {
        let cancelled = false;
        let unlisten: UnlistenFn | undefined;
        let lastEpoch = -1;

        (async () => {
            // Register listener FIRST to avoid missing events emitted
            // between the invoke response and listener registration.
            try {
                unlisten = await listen<EngineState>(ENGINE_STATE_EVENT, (e) => {
                    const next = e.payload;
                    if (!next || typeof next.epoch !== 'number') return;
                    if (next.epoch <= lastEpoch) return;
                    lastEpoch = next.epoch;
                    setState(next);
                });
            } catch (e) {
                console.error('[engine-state] listen failed:', e);
            }

            // Then fetch the current snapshot. If an event arrived between
            // listen registration and this invoke, the epoch guard above
            // ensures the fresher value wins.
            try {
                const snapshot = await invoke<EngineState>('get_engine_state');
                if (cancelled) return;
                if (snapshot.epoch > lastEpoch) {
                    lastEpoch = snapshot.epoch;
                    setState(snapshot);
                }
            } catch (e) {
                console.error('[engine-state] get_engine_state failed:', e);
            }
        })();

        return () => {
            cancelled = true;
            unlisten?.();
        };
    }, []);

    return state;
}

export const EngineStateContext = createContext<EngineState>(IDLE_STATE);

export function useEngineState(): EngineState {
    return useContext(EngineStateContext);
}

export function clearEngineError(): Promise<void> {
    return invoke('clear_engine_error');
}
