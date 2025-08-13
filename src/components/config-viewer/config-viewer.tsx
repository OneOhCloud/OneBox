import { BaseDirectory, readTextFile } from '@tauri-apps/plugin-fs';
import { useEffect, useState } from 'react';
import { t } from "../../utils/helper";

export default function ConfigViewer() {
    const [configContent, setConfigContent] = useState<string>('');
    const [error, setError] = useState<string>('');

    useEffect(() => {
        const loadConfig = async () => {
            try {
                const configJson = await readTextFile('config.json', {
                    baseDir: BaseDirectory.AppConfig,
                });
                setConfigContent(JSON.stringify(JSON.parse(configJson), null, 2));
            } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
            }
        };

        loadConfig();
    }, []);

    if (error) {
        return (
            <div className="p-4 text-error">
                <p>{t("error_loading_config") || "Error loading config:"}</p>
                <p className="font-mono text-sm mt-2">{error}</p>
            </div>
        );
    }

    return (
        <div className="h-full">
            <pre className="bg-base-200 p-4 rounded-lg border border-base-300 overflow-auto h-full font-mono text-sm text-base-content">
                {configContent || t("loading") || "Loading..."}
            </pre>
        </div>
    );
}
