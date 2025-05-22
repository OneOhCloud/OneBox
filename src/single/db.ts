import Database from '@tauri-apps/plugin-sql';

let dbPromise: Promise<Database> | null = null;

export function getDataBaseInstance(): Promise<Database> {
    if (!dbPromise) {
        dbPromise = Database.load('sqlite:data.db');
    }
    return dbPromise;
}
