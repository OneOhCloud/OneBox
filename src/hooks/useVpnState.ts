import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { createContext, useContext, useEffect, useState } from 'react';
import { IDLE_STATE, VPN_STATE_EVENT, VpnState } from '../types/vpn-state';

// Mount-at-root hook. Call `invoke('get_vpn_state')` first to seed the
// snapshot — events emitted before `listen()` attaches would otherwise be
// lost — then subscribe. `epoch` is strictly monotonic from the Rust side
// (bumped under the state lock), so we use it to drop out-of-order events.
export function useVpnStateRoot(): VpnState {
    const [state, setState] = useState<VpnState>(IDLE_STATE);

    useEffect(() => {
        let cancelled = false;
        let unlisten: UnlistenFn | undefined;
        let lastEpoch = -1;

        (async () => {
            try {
                const snapshot = await invoke<VpnState>('get_vpn_state');
                if (cancelled) return;
                setState(snapshot);
                lastEpoch = snapshot.epoch;
            } catch (e) {
                console.error('[vpn-state] get_vpn_state failed:', e);
            }

            try {
                unlisten = await listen<VpnState>(VPN_STATE_EVENT, (e) => {
                    const next = e.payload;
                    if (!next || typeof next.epoch !== 'number') return;
                    if (next.epoch <= lastEpoch) return;
                    lastEpoch = next.epoch;
                    setState(next);
                });
            } catch (e) {
                console.error('[vpn-state] listen failed:', e);
            }
        })();

        return () => {
            cancelled = true;
            unlisten?.();
        };
    }, []);

    return state;
}

export const VpnStateContext = createContext<VpnState>(IDLE_STATE);

export function useVpnState(): VpnState {
    return useContext(VpnStateContext);
}

export function clearVpnError(): Promise<void> {
    return invoke('clear_vpn_error');
}
