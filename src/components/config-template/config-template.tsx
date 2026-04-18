import { listen } from '@tauri-apps/api/event';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { fetch } from '@tauri-apps/plugin-http';
import { parse } from 'jsonc-parser';
import { useEffect, useState } from 'react';
import { ArrowClockwise, ArrowCounterclockwise, Check, Copy, ExclamationCircle } from 'react-bootstrap-icons';
import { toast, Toaster } from 'sonner';
import { configType, getConfigTemplateCacheKey } from '../../config/common';
import { getConfigTemplateURL, getDefaultConfigTemplateURL, getStoreValue, setConfigTemplateURL, setStoreValue } from '../../single/store';
import { t } from "../../utils/helper";

const CONFIG_MODES: Array<{ value: configType; label: string }> = [
    { value: 'mixed', label: 'Mixed Rules' },
    { value: 'tun', label: 'TUN Rules' },
    { value: 'mixed-global', label: 'Mixed Global' },
    { value: 'tun-global', label: 'TUN Global' },
];

// 工具函数
const formatError = (err: unknown) => err instanceof Error ? err.message : String(err);

const validateConfigFormat = (content: string): boolean => {
    try {
        parse(content);
        return true;
    } catch {
        return false;
    }
};

const formatJSON = (jsonString: string) => JSON.stringify(JSON.parse(jsonString), null, 2);

export default function ConfigTemplate() {
    const [selectedMode, setSelectedMode] = useState<configType>('mixed');
    const [templatePath, setTemplatePath] = useState('');
    const [originalTemplatePath, setOriginalTemplatePath] = useState('');
    const [defaultTemplatePath, setDefaultTemplatePath] = useState('');
    const [configContent, setConfigContent] = useState('');
    const [loading, setLoading] = useState(false);
    const [hasUnsavedContent, setHasUnsavedContent] = useState(false);

    // 加载并保存配置内容
    const saveConfigContent = async (content: string, isLocalFile = false) => {
        const jsonRes = parse(content);
        const jsonString = JSON.stringify(jsonRes);
        const cacheKey = await getConfigTemplateCacheKey(selectedMode);

        await setStoreValue(cacheKey, jsonString);
        setConfigContent(formatJSON(jsonString));

        if (isLocalFile) {
            const localFilePath = 'local file';
            await setConfigTemplateURL(selectedMode, localFilePath);
            setTemplatePath(localFilePath);
            setOriginalTemplatePath(localFilePath);
        }

        setHasUnsavedContent(false);
    };

    // 加载配置内容
    const loadConfigContent = async (mode: configType) => {
        const cacheKey = await getConfigTemplateCacheKey(mode);
        const cached = await getStoreValue(cacheKey, '');
        setConfigContent(cached ? formatJSON(cached) : '');
    };

    // 加载模板路径
    const loadTemplatePath = async () => {
        try {
            const [path, defaultPath] = await Promise.all([
                getConfigTemplateURL(selectedMode),
                getDefaultConfigTemplateURL(selectedMode)
            ]);

            setTemplatePath(path);
            setOriginalTemplatePath(path);
            setDefaultTemplatePath(defaultPath);
            await loadConfigContent(selectedMode);
            setHasUnsavedContent(false);
        } catch (err) {
            toast.error(formatError(err));
        }
    };

    // 同步远程配置
    const syncRemoteConfig = async (url: string) => {
        if (!url.startsWith('https://')) {
            throw new Error('Only HTTPS URLs are supported');
        }


        console.debug('Syncing remote config from ', url);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        try {
            const response = await fetch(url, { signal: controller.signal });
            if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`);
            const text = await response.text();
            if (!validateConfigFormat(text)) throw new Error('Invalid JSON/JSONC format');
            await saveConfigContent(text);
            console.debug('Remote config fetched successfully');

        } finally {
            clearTimeout(timeoutId);
        }
    };

    // 处理文件拖放
    const handleFileDrop = async (filePath: string) => {
        if (!filePath.endsWith('.json') && !filePath.endsWith('.jsonc')) {
            throw new Error('Only JSON/JSONC files are supported');
        }

        const text = await readTextFile(filePath);
        if (!validateConfigFormat(text)) {
            throw new Error('Invalid JSON/JSONC format');
        }

        await saveConfigContent(text, true);
    };

    useEffect(() => {
        loadTemplatePath();
    }, [selectedMode]);

    useEffect(() => {
        let unListen: (() => void) | undefined;
        let isMounted = true;

        (async () => {
            const unlisten = await listen('tauri://drag-drop', async (event) => {
                if (!isMounted) return;
                try {
                    await handleFileDrop((event as any).payload.paths[0]);
                    toast.success('File loaded and saved successfully');
                } catch (err) {
                    toast.error(formatError(err));
                }
            });
            if (isMounted) {
                unListen = unlisten;
            } else {
                unlisten();
            }
        })();

        return () => {
            isMounted = false;
            unListen?.();
        };
    }, [selectedMode]);

    const handleSync = async () => {
        if (!templatePath.trim()) {
            toast.error('Template path cannot be empty');
            return;
        }

        setLoading(true);
        toast.promise(
            syncRemoteConfig(templatePath),
            {
                loading: 'Syncing template...',
                success: 'Template synced successfully',
                error: formatError,
                finally: () => setLoading(false),
            }
        );
    };

    const handleSave = () => {
        if (!templatePath.trim()) {
            toast.error('Template path cannot be empty');
            return;
        }

        toast.promise(
            (async () => {
                await setConfigTemplateURL(selectedMode, templatePath);
                setOriginalTemplatePath(templatePath);
            })(),
            {
                loading: 'Saving template path...',
                success: 'Template path saved successfully',
                error: formatError,
            }
        );
    };

    const handleCopy = () => {
        if (!configContent) {
            toast.error('No content to copy');
            return;
        }
        toast.promise(
            navigator.clipboard.writeText(configContent),
            {
                loading: 'Copying config...',
                success: t("config_copied_to_clipboard") || 'Copied to clipboard',
                error: formatError,
            }
        );
    };

    const handleRestoreDefault = async () => {
        try {
            setTemplatePath(defaultTemplatePath);
            setOriginalTemplatePath(defaultTemplatePath);
            await setConfigTemplateURL(selectedMode, defaultTemplatePath);
            await loadConfigContent(selectedMode);
            setHasUnsavedContent(false);
            toast.success('Restored to default template path');
        } catch (err) {
            toast.error(formatError(err));
        }
    };

    const hasPathChanged = templatePath !== originalTemplatePath;
    const isDefaultPath = templatePath === defaultTemplatePath;
    const showUnsavedIndicator = hasUnsavedContent && configContent;

    return (
        <div className="h-full flex flex-col">
            <Toaster position="top-center" />
            {/* Secondary toolbar row: mode picker + remote-URL path + actions.
                Sits below the main macOS toolbar; same material (hairline),
                smaller height so the two strips read as stacked chrome. */}
            <div
                className="flex gap-2 items-center px-3"
                style={{
                    height: 36,
                    borderBottom: '0.5px solid var(--onebox-separator)',
                    background: 'var(--onebox-toolbar-bg)',
                    backdropFilter: 'blur(24px) saturate(180%)',
                    WebkitBackdropFilter: 'blur(24px) saturate(180%)',
                }}
            >
                <select
                    className="onebox-select"
                    value={selectedMode}
                    onChange={(e) => setSelectedMode(e.target.value as configType)}
                >
                    {CONFIG_MODES.map(mode => (
                        <option key={mode.value} value={mode.value}>{mode.label}</option>
                    ))}
                </select>

                {templatePath.startsWith('local file') ? (
                    <div
                        className="flex-1 flex items-center gap-2 px-2 rounded-md"
                        style={{
                            background: 'rgba(255, 59, 48, 0.12)',
                            border: '0.5px solid rgba(255, 59, 48, 0.25)',
                            height: 24,
                        }}
                    >
                        <ExclamationCircle size={12} style={{ color: 'var(--onebox-red)' }} />
                        <div className="text-[11px]" style={{ color: 'var(--onebox-red)' }}>
                            {t('local_file_warning') || ''}
                        </div>
                        <button
                            className="onebox-toolbar-btn ml-auto"
                            onClick={handleRestoreDefault}
                            title="恢复默认"
                        >
                            <ArrowCounterclockwise size={12} />
                        </button>
                    </div>
                ) : (
                    <div className="flex-1 flex items-center gap-1">
                        <label className="onebox-search flex-1">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
                                <path d="M14 2v4a2 2 0 0 0 2 2h4" />
                            </svg>
                            <input
                                type="text"
                                placeholder="https://... or drag & drop JSON/JSONC file"
                                value={templatePath}
                                onChange={(e) => setTemplatePath(e.target.value)}
                            />
                        </label>

                        {hasPathChanged && (
                            <button
                                className="onebox-toolbar-btn"
                                onClick={handleSave}
                                title={t('save') || 'Save'}
                                style={{ color: 'var(--onebox-red)' }}
                            >
                                <Check size={12} />
                            </button>
                        )}

                        {!isDefaultPath && (
                            <button
                                className="onebox-toolbar-btn"
                                onClick={handleRestoreDefault}
                                title="Restore default"
                            >
                                <ArrowCounterclockwise size={12} />
                            </button>
                        )}

                        <button
                            className="onebox-toolbar-btn"
                            onClick={handleSync}
                            disabled={loading}
                            title={t('update') || 'Update'}
                            style={{ color: 'var(--onebox-blue)' }}
                        >
                            <ArrowClockwise className={loading ? 'animate-spin' : ''} size={12} />
                        </button>
                    </div>
                )}
            </div>

            <pre
                className="relative px-4 pt-3 pb-4 overflow-auto flex-1 text-[11px] leading-relaxed onebox-selectable"
                style={{
                    fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
                    color: 'var(--onebox-label)',
                    margin: 0,
                    whiteSpace: 'pre',
                }}
            >
                <div className="absolute top-2 right-3 z-10 flex gap-1.5">
                    {showUnsavedIndicator && (
                        <div
                            className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px]"
                            title="Unsaved content from dropped file"
                            style={{
                                background: 'rgba(255, 149, 0, 0.15)',
                                color: 'var(--onebox-orange)',
                            }}
                        >
                            <ExclamationCircle size={11} />
                            <span>Unsaved</span>
                        </div>
                    )}
                    <button
                        className="onebox-toolbar-btn disabled:opacity-40"
                        onClick={handleCopy}
                        disabled={!configContent}
                        title={t('config_copied_to_clipboard') || 'Copy'}
                        style={{ color: 'var(--onebox-blue)' }}
                    >
                        <Copy size={12} />
                    </button>
                </div>
                {configContent || (
                    <div
                        className="text-center py-12 text-[12px]"
                        style={{ color: 'var(--onebox-label-tertiary)' }}
                    >
                        {"No content loaded. Click Sync to load from URL or drag & drop a JSON/JSONC file here."}
                    </div>
                )}
            </pre>
        </div>
    );
}
