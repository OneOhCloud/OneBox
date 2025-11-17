import { BaseDirectory, readTextFile } from '@tauri-apps/plugin-fs';
import { Copy } from 'react-bootstrap-icons';
import { toast, Toaster } from 'sonner';
import useSWR from 'swr';
import { t } from "../../utils/helper";

const loadConfig = async () => {
    const configJson = await readTextFile('config.json', {
        baseDir: BaseDirectory.AppConfig,
    });
    return JSON.stringify(JSON.parse(configJson), null, 2);
};

export default function ConfigViewer() {
    const { data: configContent, error } = useSWR(
        'config.json',
        loadConfig,
        {
            refreshInterval: 1000,
            revalidateOnFocus: true,
        }
    );

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
                <p className="font-mono text-sm mt-2">{error instanceof Error ? error.message : String(error)}</p>
            </div>
        );
    }

    return (
        <div className="h-full pt-2" >
            <Toaster position="top-center" />
            <pre className="relative bg-gray-50 px-4 pb-4 pt-2 rounded-xl border border-gray-200 overflow-auto h-full text-xs shadow-inner"
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
