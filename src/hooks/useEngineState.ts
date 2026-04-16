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
            try {
                const snapshot = await invoke<EngineState>('get_engine_state');
                if (cancelled) return;
                setState(snapshot);
                lastEpoch = snapshot.epoch;
            } catch (e) {
                console.error('[engine-state] get_engine_state failed:', e);
            }

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
