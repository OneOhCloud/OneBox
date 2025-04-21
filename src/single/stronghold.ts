import { appDataDir } from "@tauri-apps/api/path";
import { BaseDirectory, exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { Client, Stronghold } from "@tauri-apps/plugin-stronghold";


let stronghold: Stronghold;
let client: Client;



async function cryptographicallySecureRandomString(): Promise<string> {
    const vaultKeyName = 'vaultKey.txt';

    if (await exists(vaultKeyName, { baseDir: BaseDirectory.AppData })) {
        const vaultKey = await readTextFile(vaultKeyName, {
            baseDir: BaseDirectory.AppConfig,
        });
        return vaultKey;
    } else {
        let array = new Uint8Array(32);
        crypto.getRandomValues(array);
        const vaultKey = Array.from(array)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');

        await writeTextFile(vaultKeyName, vaultKey, {
            baseDir: BaseDirectory.AppData,
        });
        return vaultKey;
    }


}



const initStronghold = async () => {
    const vaultPath = `${await appDataDir()}/vault.hold`;

    const vaultKey = await cryptographicallySecureRandomString();

    const stronghold = await Stronghold.load(vaultPath, vaultKey);

    let client: Client;

    const clientName = "onebox";

    try {
        client = await stronghold.loadClient(clientName);
    } catch {
        client = await stronghold.createClient(clientName);
    }

    return {
        stronghold,
        client,
    };
};



export async function getClient(): Promise<Client> {
    if (client && stronghold) {
        return client;
    }
    if (!stronghold) {
        const { stronghold: newStronghold, client: newClient } = await initStronghold();
        stronghold = newStronghold;
        client = newClient;
    }
    return client;
}


export async function savePrivilegeIdentifier(username: string, password: string) {
    const client = await getClient();
}



