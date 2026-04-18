import { BaseDirectory, readTextFile } from '@tauri-apps/plugin-fs';
import { useEffect } from 'react';
import useSWR from 'swr';
import { t } from "../../utils/helper";

const loadConfig = async () => {
    const configJson = await readTextFile('config.json', {
        baseDir: BaseDirectory.AppConfig,
    });
    return JSON.stringify(JSON.parse(configJson), null, 2);
};

// `onContent` lets the parent toolbar host a Copy button without this
// component knowing about it — keeps the content pane frameless.
interface ConfigViewerProps {
    onContent?: (content: string | undefined) => void;
}

export default function ConfigViewer({ onContent }: ConfigViewerProps) {
    const { data: configContent, error } = useSWR(
        'config.json',
        loadConfig,
        {
            refreshInterval: 1000,
            revalidateOnFocus: true,
        }
    );

    useEffect(() => {
        onContent?.(configContent);
    }, [configContent, onContent]);

    if (error) {
        return (
            <div
                className="px-4 py-4 font-mono text-xs onebox-selectable"
                style={{ color: 'var(--onebox-red)' }}
            >
                <p>{t("error_loading_config") || "Error loading config:"}</p>
                <p className="mt-2">
                    {error instanceof Error ? error.message : String(error)}
                </p>
            </div>
        );
    }

    return (
        <pre
            className="px-4 py-3 text-[11px] leading-relaxed onebox-selectable"
            style={{
                fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
                color: 'var(--onebox-label)',
                margin: 0,
                whiteSpace: 'pre',
                overflowX: 'auto',
            }}
        >
            {configContent || (
                <span style={{ color: 'var(--onebox-label-tertiary)' }}>
                    {t("loading") || "Loading..."}
                </span>
            )}
        </pre>
    );
}
