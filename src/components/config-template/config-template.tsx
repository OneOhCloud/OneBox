import { open } from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { parse } from 'jsonc-parser';
import { useEffect, useState } from 'react';
import { ArrowClockwise, ArrowCounterclockwise, Check, Copy, Folder } from 'react-bootstrap-icons';
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

export default function ConfigTemplate() {
    const [selectedMode, setSelectedMode] = useState<configType>('mixed');
    const [templatePath, setTemplatePath] = useState<string>('');
    const [originalTemplatePath, setOriginalTemplatePath] = useState<string>('');
    const [defaultTemplatePath, setDefaultTemplatePath] = useState<string>('');
    const [configContent, setConfigContent] = useState<string>('');
    const [loading, setLoading] = useState<boolean>(false);

    useEffect(() => {
        loadTemplatePathAndContent();
    }, [selectedMode]);

    const loadTemplatePathAndContent = async () => {
        try {
            const path = await getConfigTemplateURL(selectedMode);
            const defaultPath = await getDefaultConfigTemplateURL(selectedMode);
            setTemplatePath(path);
            setOriginalTemplatePath(path);
            setDefaultTemplatePath(defaultPath);
            await loadConfigContent(selectedMode);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err));
        }
    };

    const loadConfigContent = async (mode: configType) => {
        try {
            const cacheKey = await getConfigTemplateCacheKey(mode);
            const cached = await getStoreValue(cacheKey, '');
            if (cached) {
                setConfigContent(JSON.stringify(JSON.parse(cached), null, 2));
            } else {
                setConfigContent('');
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err));
        }
    };

    const validateConfigFormat = (content: string): boolean => {
        try {
            parse(content);
            return true;
        } catch {
            return false;
        }
    };

    const syncRemoteConfig = async (mode: configType, url: string) => {
        if (url.startsWith('https://')) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 60000);

            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`Failed to fetch: ${response.statusText}`);
            }

            const text = await response.text();

            if (!validateConfigFormat(text)) {
                throw new Error('Invalid JSON/JSONC format');
            }

            const jsonRes = parse(text);
            const jsonString = JSON.stringify(jsonRes);

            const cacheKey = await getConfigTemplateCacheKey(mode);
            await setStoreValue(cacheKey, jsonString);

            return jsonString;
        } else {
            // 读取本地文件 (支持完整路径: Windows: C:\path\to\file.json, macOS/Linux: /path/to/file.json)
            if (!url.endsWith('.json') && !url.endsWith('.jsonc')) {
                throw new Error('Only JSON/JSONC files are supported');
            }

            const text = await readTextFile(url);

            if (!validateConfigFormat(text)) {
                throw new Error('Invalid JSON/JSONC format');
            }

            const jsonRes = parse(text);
            const jsonString = JSON.stringify(jsonRes);

            const cacheKey = await getConfigTemplateCacheKey(mode);
            await setStoreValue(cacheKey, jsonString);

            return jsonString;
        }
    };

    const handleSync = async () => {
        if (!templatePath.trim()) {
            toast.error('Template path cannot be empty');
            return;
        }

        setLoading(true);
        toast.promise(
            (async () => {
                const jsonString = await syncRemoteConfig(selectedMode, templatePath);
                setConfigContent(JSON.stringify(JSON.parse(jsonString), null, 2));
                return true;
            })(),
            {
                loading: 'Syncing template...',
                success: 'Template synced successfully',
                error: (err) => err instanceof Error ? err.message : String(err),
                finally: () => setLoading(false),
            }
        );
    };

    const handleSave = async () => {
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
                error: (err) => err instanceof Error ? err.message : String(err),
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
                error: (err) => err instanceof Error ? err.message : String(err),
            }
        );
    };

    const handleSelectFile = async () => {
        try {
            const selected = await open({
                multiple: false,
                filters: [{
                    name: 'Config',
                    extensions: ['json', 'jsonc']
                }]
            });

            if (!selected) return;

            const text = await readTextFile(selected);

            if (!validateConfigFormat(text)) {
                throw new Error('Invalid JSON/JSONC format');
            }

            const jsonRes = parse(text);
            const jsonString = JSON.stringify(jsonRes);

            const cacheKey = await getConfigTemplateCacheKey(selectedMode);
            await setStoreValue(cacheKey, jsonString);

            setConfigContent(JSON.stringify(JSON.parse(jsonString), null, 2));

            // 保存完整的文件路径
            setTemplatePath(selected);

            // 自动保存本地文件路径
            await setConfigTemplateURL(selectedMode, selected);
            setOriginalTemplatePath(selected);

            toast.success('File loaded successfully');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err));
        }
    };

    const handleRestoreDefault = async () => {
        try {
            setTemplatePath(defaultTemplatePath);
            setOriginalTemplatePath(defaultTemplatePath);
            toast.success('Restored to default template path');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err));
        }
    };

    const hasPathChanged = templatePath !== originalTemplatePath;
    const isDefaultPath = templatePath === defaultTemplatePath;

    return (
        <div className="h-full flex flex-col  px-2">
            <Toaster position="top-center" />
            <div className="mt-1 flex gap-2  items-baseline">
                <select
                    className="select select-bordered w-auto select-xs bg-blue-50/50 border-blue-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all duration-200 hover:bg-blue-50"
                    value={selectedMode}
                    onChange={(e) => setSelectedMode(e.target.value as configType)}
                >
                    {CONFIG_MODES.map(mode => (
                        <option key={mode.value} value={mode.value}>{mode.label}</option>
                    ))}
                </select>
                <div className="relative flex-1">
                    <input
                        type="text"
                        className="input input-xs input-bordered w-full text-sm pr-8 bg-white border-gray-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all duration-200"
                        placeholder="https://... or /path/to/config.jsonc"
                        value={templatePath}
                        onChange={(e) => setTemplatePath(e.target.value)}
                    />
                    {hasPathChanged && (
                        <button
                            className="btn btn-xs btn-circle btn-ghost absolute right-1 top-1/2 -translate-y-1/2 hover:bg-blue-50 transition-all duration-200"
                            onClick={handleSave}
                            title={t('save') || 'Save'}
                        >
                            <Check className="text-blue-600" size={16} />
                        </button>
                    )}
                </div>
                <button
                    className="btn btn-xs btn-square bg-white border-gray-200 hover:bg-blue-50 hover:border-blue-300 transition-all duration-200 hover:shadow-sm"
                    onClick={handleSelectFile}
                    title="Select local file"
                >
                    <Folder className="text-gray-600" />
                </button>
                {!isDefaultPath && (
                    <button
                        className="btn btn-xs btn-square bg-white border-gray-200 hover:bg-blue-50 hover:border-blue-300 transition-all duration-200 hover:shadow-sm"
                        onClick={handleRestoreDefault}
                        title="Restore default"
                    >
                        <ArrowCounterclockwise className="text-gray-600" />
                    </button>
                )}

                <button
                    className="btn btn-xs bg-blue-600 text-white border-0 hover:bg-blue-700 disabled:bg-gray-300 transition-all duration-200 hover:shadow-md hover:scale-105 disabled:scale-100"
                    onClick={handleSync}
                    disabled={loading}
                >
                    <ArrowClockwise className={loading ? 'animate-spin' : ''} />
                    {t('update') || '更新'}
                </button>

            </div>

            <pre className="mt-2  relative bg-gray-50 px-4 pb-4 pt-2 rounded-lg border border-gray-200 overflow-auto flex-1 text-xs shadow-inner">
                <button
                    className="btn btn-xs btn-ghost absolute top-2 right-2 z-10 bg-white/90 backdrop-blur-sm hover:bg-blue-50 border border-gray-200 hover:border-blue-300 transition-all duration-200 hover:shadow-sm disabled:opacity-40"
                    onClick={handleCopy}
                    disabled={!configContent}
                >
                    <Copy className="text-blue-600" />
                </button>
                <div className="text-gray-700">
                    {configContent || t("loading") || "No content loaded. Click Sync to load template."}
                </div>
            </pre>
        </div>
    );
}
