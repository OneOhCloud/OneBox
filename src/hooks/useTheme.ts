import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useCallback, useEffect, useState } from 'react';
import { getStoreValue, setStoreValue } from '../single/store';
import { THEME_PREF_STORE_KEY } from '../types/definition';

export type ThemePref = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const VALID_PREFS: readonly ThemePref[] = ['light', 'dark', 'system'];
// Within a single window: CustomEvent so sibling useTheme() consumers
// re-resolve after a setPref() call (tauri-plugin-store doesn't emit a
// JS-side change event for our own writes).
const THEME_CHANGE_EVENT = 'onebox:theme-change';
// Across windows (main + log): Tauri event, since each Tauri window has
// its own `document.documentElement` — a DOM CustomEvent only reaches
// listeners inside the same WebView.
const TAURI_THEME_EVENT = 'onebox:theme-change';

// Tell the OS to use light/dark native chrome (macOS NSAppearance, Windows
// dark title bar).
//
// On Tauri 2.10 + macOS 26 we observed `window.setTheme()` silently no-op
// the NSWindow.appearance — the JS call resolves without error but the
// title bar stays Aqua. Workaround: a custom Rust command
// `set_native_window_theme` bridges to AppKit directly on the main
// thread. We invoke both so Windows/Linux still get the canonical path
// and macOS gets the reliable override.
async function applyNativeChrome(pref: ThemePref): Promise<void> {
    const target = pref === 'system' ? null : pref;
    const win = getCurrentWindow();

    // Canonical path — works on Windows/Linux, best-effort on macOS.
    try {
        await win.setTheme(target);
    } catch (err) {
        console.warn('[theme] window.setTheme failed:', err);
    }

    // Native-side override — macOS only (no-op on other platforms).
    try {
        await invoke('set_native_window_theme', { theme: target });
    } catch (err) {
        console.warn('[theme] set_native_window_theme failed:', err);
    }
}

function applyThemeAttr(pref: ThemePref): void {
    document.documentElement.dataset.theme = pref;
}

function resolveTheme(pref: ThemePref): ResolvedTheme {
    if (pref === 'light') return 'light';
    if (pref === 'dark') return 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// Read once at module load so the first paint already reflects the last
// user choice. Falls back to 'system' on any error (first run / store
// unreadable). Can't be `async` at module scope — LazyStore is not ready
// synchronously — so we start with 'system' and patch in useEffect.
applyThemeAttr('system');

export function useTheme() {
    const [pref, setPrefState] = useState<ThemePref>('system');
    const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme('system'));

    // Initial load from the persistent store.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const stored = await getStoreValue(THEME_PREF_STORE_KEY);
            if (cancelled) return;
            const next: ThemePref = VALID_PREFS.includes(stored) ? stored : 'system';
            setPrefState(next);
            applyThemeAttr(next);
            setResolved(resolveTheme(next));
            applyNativeChrome(next);
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    // Subscribe to same-window updates (another component flipping the toggle).
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent<ThemePref>).detail;
            if (!detail) return;
            setPrefState(detail);
            applyThemeAttr(detail);
            setResolved(resolveTheme(detail));
            applyNativeChrome(detail);
        };
        window.addEventListener(THEME_CHANGE_EVENT, handler);
        return () => window.removeEventListener(THEME_CHANGE_EVENT, handler);
    }, []);

    // Subscribe to cross-window updates. main window toggles flip log
    // window's theme in real time without a reload.
    useEffect(() => {
        const unlistenPromise = listen<ThemePref>(TAURI_THEME_EVENT, (event) => {
            const next = event.payload;
            if (!VALID_PREFS.includes(next)) return;
            setPrefState(next);
            applyThemeAttr(next);
            setResolved(resolveTheme(next));
            applyNativeChrome(next);
        });
        return () => {
            unlistenPromise.then((fn) => fn()).catch(() => { });
        };
    }, []);

    // When pref is 'system', re-resolve on OS theme change AND poke the
    // native chrome. CSS media queries are live (so --onebox-* tokens
    // flip automatically), but:
    //   - `resolved` in React state needs updating for consumers that
    //     render based on it (e.g. the developer-page icon).
    //   - `applyNativeChrome('system')` re-sends `null` to NSWindow.
    //     Empirically, once an explicit appearance has been set on a
    //     macOS window, switching back to nil + relying on the parent
    //     NSApp doesn't always repaint the title bar on the next OS
    //     toggle. Re-sending `nil` on each OS flip nudges it.
    useEffect(() => {
        if (pref !== 'system') return;
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = () => {
            setResolved(mq.matches ? 'dark' : 'light');
            applyNativeChrome('system');
        };
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, [pref]);

    const setPref = useCallback(async (next: ThemePref) => {
        applyThemeAttr(next);
        setPrefState(next);
        setResolved(resolveTheme(next));
        applyNativeChrome(next);
        // Same-window sibling hooks.
        window.dispatchEvent(new CustomEvent<ThemePref>(THEME_CHANGE_EVENT, { detail: next }));
        // Cross-window: other Tauri windows (e.g. the advanced-settings /
        // log window) need to apply this on their own <html>.
        emit(TAURI_THEME_EVENT, next).catch(() => { });
        await setStoreValue(THEME_PREF_STORE_KEY, next);
    }, []);

    return { pref, resolved, setPref };
}
