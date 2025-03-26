import { LazyStore } from '@tauri-apps/plugin-store';


export const store = new LazyStore('settings.json', {
    autoSave: true
});

