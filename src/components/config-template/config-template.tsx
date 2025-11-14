import { open } from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { parse } from 'jsonc-parser';
import { useEffect, useState } from 'react';
import { ArrowClockwise, ArrowCounterclockwise, Copy, Folder } from 'react-bootstrap-icons';
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
    const [configContent, setConfigContent] = useState<string>('');
    const [loading, setLoading] = useState<boolean>(false);

    useEffect(() => {
        loadTemplatePathAndContent();
    }, [selectedMode]);

    const loadTemplatePathAndContent = async () => {
        try {
            const path = await getConfigTemplateURL(selectedMode);
            setTemplatePath(path);
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
        } else if (url.startsWith('file://') || url.startsWith('/')) {
            const filePath = url.replace('file://', '');

            if (!filePath.endsWith('.json') && !filePath.endsWith('.jsonc')) {
                throw new Error('Only JSON/JSONC files are supported');
            }

            const text = await readTextFile(filePath);

            if (!validateConfigFormat(text)) {
                throw new Error('Invalid JSON/JSONC format');
            }

            const jsonRes = parse(text);
            const jsonString = JSON.stringify(jsonRes);

            const cacheKey = await getConfigTemplateCacheKey(mode);
            await setStoreValue(cacheKey, jsonString);

            return jsonString;
        } else {
            throw new Error('Only HTTPS URLs or local file paths are supported');
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
            setConfigTemplateURL(selectedMode, templatePath),
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
                    name: 'Config Files',
                    extensions: ['json', 'jsonc']
                }]
            });

            if (selected && typeof selected === 'string') {
                setTemplatePath(selected);
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err));
        }
    };

    const handleRestoreDefault = async () => {
        try {
            const defaultPath = await getDefaultConfigTemplateURL(selectedMode);
            setTemplatePath(defaultPath);
            toast.success('Restored to default template path');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err));
        }
    };

    return (
        <div className="h-full flex flex-col gap-2 px-2">
            <Toaster position="top-center" />
            <div className="flex gap-2">
                <select
                    className="select select-bordered w-auto select-xs"
                    value={selectedMode}
                    onChange={(e) => setSelectedMode(e.target.value as configType)}
                >
                    {CONFIG_MODES.map(mode => (
                        <option key={mode.value} value={mode.value}>{mode.label}</option>
                    ))}
                </select>
                <input
                    type="text"
                    className="input  input-xs input-bordered flex-1 text-sm"
                    placeholder="https://... or /path/to/config.jsonc"
                    value={templatePath}
                    onChange={(e) => setTemplatePath(e.target.value)}
                />
                <button
                    className="btn btn-xs btn-square"
                    onClick={handleSelectFile}
                    title="Select local file"
                >
                    <Folder />
                </button>
                <button
                    className="btn btn-xs btn-square"
                    onClick={handleRestoreDefault}
                    title="Restore default"
                >
                    <ArrowCounterclockwise />
                </button>
                <button
                    className="btn btn-xs btn-primary"
                    onClick={handleSave}
                >
                    {t('save') || 'Save'}
                </button>
                <button
                    className="btn btn-xs  btn-secondary"
                    onClick={handleSync}
                    disabled={loading}
                >
                    <ArrowClockwise className={loading ? 'animate-spin' : ''} />
                    {t('sync') || 'Sync'}
                </button>
            </div>

            <pre className="relative bg-base-200 px-4 pb-4 pt-2 rounded-lg border border-base-300 overflow-auto flex-1 text-xs">
                <button
                    className="btn btn-xs btn-ghost absolute top-2 right-2 z-10"
                    onClick={handleCopy}
                    disabled={!configContent}
                >
                    <Copy />
                </button>
                <div>
                    {configContent || t("loading") || "No content loaded. Click Sync to load template."}
                </div>
            </pre>
        </div>
    );
}
