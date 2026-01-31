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


        console.debug('Syncing remote config from', url + '?t=' + Date.now());
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000);

        try {
            const response = await fetch(url + '?version=' + Date.now(), { signal: controller.signal, cache: 'no-store' });
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
        <div className="h-full flex flex-col  ">
            <Toaster position="top-center" />
            <div className="pt-1 flex gap-2 items-center px-1">
                <select
                    className="select select-bordered w-auto select-xs bg-blue-50/50 border-blue-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all duration-200 hover:bg-blue-50"
                    value={selectedMode}
                    onChange={(e) => setSelectedMode(e.target.value as configType)}
                >
                    {CONFIG_MODES.map(mode => (
                        <option key={mode.value} value={mode.value}>{mode.label}</option>
                    ))}
                </select>

                {templatePath.startsWith('local file') ? (
                    <div className="flex-1 bg-red-50  rounded-md pl-2">
                        <div className="flex  items-center gap-2">
                            <ExclamationCircle className="text-red-600 shrink-0" />
                            <div className="text-xs text-red-700">
                                {/* 本地文件只会在拖动进来的时候读取一次,sing-box 主要版本更新时会清空本地文件配置。 */}
                                {t('local_file_warning') || ''}
                            </div>
                            <button
                                className="btn btn-ghost btn-xs btn-error ml-auto "
                                onClick={handleRestoreDefault}
                                title="恢复默认"
                            >
                                <ArrowCounterclockwise size={16} />
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="join flex-1">
                        <label className="input input-xs input-bordered join-item bg-white border-gray-200 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 transition-all duration-200 hover:border-gray-300 flex items-center gap-2 flex-1">
                            <svg className="h-[1em] opacity-50 shrink-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                                <g strokeLinejoin="round" strokeLinecap="round" strokeWidth="2.5" fill="none" stroke="currentColor">
                                    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path>
                                    <path d="M14 2v4a2 2 0 0 0 2 2h4"></path>
                                </g>
                            </svg>
                            <input
                                type="text"
                                className="grow text-sm bg-transparent border-0 outline-none focus:outline-none p-0 min-w-0"
                                placeholder="https://... or drag & drop JSON/JSONC file"
                                value={templatePath}
                                onChange={(e) => setTemplatePath(e.target.value)}
                            />
                        </label>

                        {hasPathChanged && (
                            <button
                                className="btn btn-xs btn-error join-item text-white hover:shadow-md transition-all duration-200"
                                onClick={handleSave}
                                title={t('save') || 'Save'}
                            >
                                <Check size={16} />
                            </button>
                        )}

                        {!isDefaultPath && (
                            <button
                                className="btn btn-xs btn-info join-item text-white hover:shadow-md transition-all duration-200"
                                onClick={handleRestoreDefault}
                                title="Restore default"
                            >
                                <ArrowCounterclockwise size={16} />
                            </button>
                        )}

                        <button
                            className="btn btn-xs btn-primary join-item text-white hover:shadow-md transition-all duration-200 disabled:bg-gray-300 disabled:text-gray-500"
                            onClick={handleSync}
                            disabled={loading}
                        >
                            <ArrowClockwise className={loading ? 'animate-spin' : ''} size={16} />
                            {t('update') || '更新'}
                        </button>
                    </div>
                )}
            </div>

            <pre
                className="mt-2 relative bg-gray-50 px-4 pb-4 pt-2 rounded-xl border border-gray-200 overflow-auto flex-1 text-xs shadow-inner cursor-pointer hover:border-blue-300 transition-all duration-200"
            >
                <div className="absolute top-2 right-2 z-10 flex gap-2">
                    {showUnsavedIndicator && (
                        <div className="tooltip tooltip-left" data-tip="Unsaved content from dropped file">
                            <div className="flex items-center gap-1 px-2 py-1 bg-orange-100 border border-orange-300 rounded text-orange-700">
                                <ExclamationCircle size={14} />
                                <span className="text-xs">Unsaved</span>
                            </div>
                        </div>
                    )}
                    <button
                        className="btn btn-xs btn-ghost bg-white/90 backdrop-blur-sm hover:bg-blue-50 border border-gray-200 hover:border-blue-300 transition-all duration-200 hover:shadow-sm disabled:opacity-40"
                        onClick={handleCopy}
                        disabled={!configContent}
                    >
                        <Copy className="text-blue-600" />
                    </button>
                </div>
                <div className="text-gray-700">
                    {configContent || (
                        <div className="text-center text-gray-400 py-8">
                            {"No content loaded. Click Sync to load from URL or drag & drop a JSON/JSONC file here."}
                        </div>
                    )}
                </div>
            </pre>
        </div>
    );
}
