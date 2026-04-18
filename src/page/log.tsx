import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowDownCircle, ArrowUpCircle, Copy, Search, Trash } from 'react-bootstrap-icons';
import { toast, Toaster } from 'sonner';
import ConfigTemplate from '../components/config-template/config-template';
import ConfigViewer from '../components/config-viewer/config-viewer';
import EmptyLogMessage from '../components/log/empty-log-message';
import LogTable from '../components/log/log-table';
import { formatNetworkSpeed, useLogSource, useNetworkSpeed } from '../utils/clash-api';
import { initLanguage, t } from '../utils/helper';

type TabKey = 'logs' | 'config' | 'config-template';

const TABS: { key: TabKey; labelKey: string; fallback: string }[] = [
    { key: 'logs', labelKey: 'log_viewer', fallback: 'Logs' },
    { key: 'config', labelKey: 'config_viewer', fallback: 'Config' },
    { key: 'config-template', labelKey: 'config_template', fallback: 'Template' },
];

// Segmented control (NSSegmentedControl) — track + lifted active pill.
// Keyed off data-active so CSS can style without React-only class lists.
function Segments({
    value,
    onChange,
}: {
    value: TabKey;
    onChange: (v: TabKey) => void;
}) {
    return (
        <div className="onebox-segctl" role="tablist">
            {TABS.map(({ key, labelKey, fallback }) => (
                <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={value === key}
                    data-active={value === key}
                    onClick={() => onChange(key)}
                    className="onebox-segctl-item"
                >
                    {t(labelKey) || fallback}
                </button>
            ))}
        </div>
    );
}

// Logs-tab toolbar tools: search field, auto-scroll toggle, clear.
function LogsTools({
    filter,
    setFilter,
    autoScroll,
    setAutoScroll,
    clearLogs,
}: {
    filter: string;
    setFilter: (s: string) => void;
    autoScroll: boolean;
    setAutoScroll: (v: boolean) => void;
    clearLogs: () => void;
}) {
    return (
        <>
            <label className="onebox-search" aria-label={t('filter_placeholder') || 'Filter'}>
                <Search size={11} />
                <input
                    type="text"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder={t('filter_placeholder') || '过滤关键词…'}
                />
            </label>
            <button
                type="button"
                className="onebox-toolbar-btn"
                data-active={autoScroll}
                onClick={() => setAutoScroll(!autoScroll)}
                title={t('auto_scroll')}
                aria-pressed={autoScroll}
            >
                <ArrowDown size={12} />
            </button>
            <button
                type="button"
                className="onebox-toolbar-btn"
                onClick={clearLogs}
                title={t('clear_log')}
            >
                <Trash size={12} />
            </button>
        </>
    );
}

// Config-tab toolbar tool: copy current JSON to clipboard.
function ConfigTools({ getContent }: { getContent: () => string | undefined }) {
    const handleCopy = () => {
        const c = getContent();
        if (!c) return;
        toast.promise(navigator.clipboard.writeText(c), {
            loading: t('loading') || 'Copying…',
            success: () => t('config_copied_to_clipboard') || 'Copied',
            error: (e) => (e instanceof Error ? e.message : String(e)),
        });
    };
    return (
        <button
            type="button"
            className="onebox-toolbar-btn"
            onClick={handleCopy}
            title={t('config_copied_to_clipboard') || 'Copy'}
        >
            <Copy size={12} />
        </button>
    );
}

export default function LogPage() {
    const [filter, setFilter] = useState('');
    const [autoScroll, setAutoScroll] = useState(true);
    const [isLanguageLoading, setIsLanguageLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<TabKey>('logs');
    const [configContent, setConfigContent] = useState<string | undefined>();
    const logContainerRef = useRef<HTMLDivElement>(null);
    const { logs, clearLogs } = useLogSource();
    const speed = useNetworkSpeed();

    const filteredLogs = filter
        ? logs.filter((log) =>
              log.message.toLowerCase().includes(filter.toLowerCase()),
          )
        : logs;

    const highlightText = (text: string, highlight: string) => {
        if (!highlight) return text;
        const parts = text.split(new RegExp(`(${highlight})`, 'gi'));
        return parts.map((part, index) =>
            part.toLowerCase() === highlight.toLowerCase() ? (
                <mark key={index} className="onebox-highlight">
                    {part}
                </mark>
            ) : (
                part
            ),
        );
    };

    useEffect(() => {
        initLanguage().finally(() => setIsLanguageLoading(false));
    }, []);

    // Wire scroll to the right container based on activeTab. We only watch
    // the logs container because config/template have their own scroll and
    // don't need the auto-scroll-to-bottom contract.
    useEffect(() => {
        if (activeTab !== 'logs') return;
        const container = logContainerRef.current;
        if (!container) return;
        const handleScroll = () => {
            const { scrollTop, scrollHeight, clientHeight } = container;
            setAutoScroll(scrollHeight - scrollTop - clientHeight < 5);
        };
        container.addEventListener('scroll', handleScroll);
        return () => container.removeEventListener('scroll', handleScroll);
    }, [activeTab]);

    useEffect(() => {
        if (autoScroll && activeTab === 'logs' && logContainerRef.current) {
            logContainerRef.current.scrollTop =
                logContainerRef.current.scrollHeight;
        }
    }, [filteredLogs, autoScroll, activeTab]);

    if (isLanguageLoading) {
        return (
            <div className="onebox-mac-window flex items-center justify-center">
                <span className="onebox-spinner onebox-spinner-ring onebox-spinner-lg" />
            </div>
        );
    }

    return (
        <div className="onebox-mac-window">
            <Toaster position="top-center" toastOptions={{ duration: 2000 }} />

            <div className="onebox-mac-toolbar">
                <Segments value={activeTab} onChange={setActiveTab} />
                <div className="flex-1" />
                {activeTab === 'logs' && (
                    <LogsTools
                        filter={filter}
                        setFilter={setFilter}
                        autoScroll={autoScroll}
                        setAutoScroll={setAutoScroll}
                        clearLogs={clearLogs}
                    />
                )}
                {activeTab === 'config' && (
                    <ConfigTools getContent={() => configContent} />
                )}
            </div>

            {/* Logs: scrollable log stream, own ref for auto-scroll. */}
            <div
                ref={logContainerRef}
                className="onebox-mac-content"
                style={{ display: activeTab === 'logs' ? 'block' : 'none' }}
                role="tabpanel"
            >
                {filteredLogs.length === 0 ? (
                    <EmptyLogMessage filter={filter} />
                ) : (
                    <LogTable
                        logs={filteredLogs}
                        filter={filter}
                        highlightText={highlightText}
                    />
                )}
            </div>

            {/* Config & template: their own inner scrollers. */}
            <div
                className="onebox-mac-content"
                style={{ display: activeTab === 'config' ? 'block' : 'none' }}
                role="tabpanel"
            >
                <ConfigViewer onContent={setConfigContent} />
            </div>
            <div
                className="onebox-mac-content"
                style={{ display: activeTab === 'config-template' ? 'block' : 'none' }}
                role="tabpanel"
            >
                <ConfigTemplate />
            </div>

            <div className="onebox-mac-statusbar">
                <span className="inline-flex items-center gap-1.5">
                    <ArrowUpCircle size={11} style={{ color: 'var(--onebox-blue)' }} />
                    <span>{formatNetworkSpeed(speed.upload)}</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                    <ArrowDownCircle size={11} style={{ color: 'var(--onebox-blue)' }} />
                    <span>{formatNetworkSpeed(speed.download)}</span>
                </span>
            </div>
        </div>
    );
}
