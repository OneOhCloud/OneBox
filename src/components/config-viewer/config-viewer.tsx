import { BaseDirectory, readTextFile } from '@tauri-apps/plugin-fs';
import { useEffect, useState } from 'react';
import { Copy } from 'react-bootstrap-icons';
import { toast, Toaster } from 'sonner';
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

    const handleCopy = () => {
        if (!configContent) {
            return
        }
        toast.promise(
            navigator.clipboard.writeText(configContent),
            {
                loading: "Copying config...",
                success: () => t("config_copied_to_clipboard"),
                error: (err) => err instanceof Error ? err.message : String(err),
            }
        )
    }

    if (error) {
        return (
            <div className="p-4 text-error">
                <p>{t("error_loading_config") || "Error loading config:"}</p>
                <p className="font-mono text-sm mt-2">{error}</p>
            </div>
        );
    }

    return (
        <div className="h-full mt-2" >
            <Toaster position="top-center" />
            <pre className="relative bg-gray-50 px-4 pb-4 pt-2 rounded-lg border border-gray-200 overflow-auto h-full text-xs shadow-inner"
            >
                <button className="btn btn-xs btn-ghost absolute top-2 right-2 z-10 bg-white/90 backdrop-blur-sm hover:bg-blue-50 border border-gray-200 hover:border-blue-300 transition-all duration-200 hover:shadow-sm disabled:opacity-40"
                    onClick={handleCopy}>
                    <Copy className="text-blue-600" />
                </button>
                <div className="text-gray-700">
                    {configContent || t("loading") || "Loading..."}
                </div>
            </pre>
        </div>
    );
}
