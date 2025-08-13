import { listen } from '@tauri-apps/api/event';
import { useEffect, useRef, useState } from 'react';
import ConfigViewer from '../components/config-viewer/config-viewer';
import { initLanguage, t } from "../utils/helper";

interface LogEntry {
    message: string;
    timestamp: string;
}

export default function LogPage() {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const logContainerRef = useRef<HTMLDivElement>(null);
    const [autoScroll, setAutoScroll] = useState(true);
    const [filter, setFilter] = useState('');
    const [isLanguageLoading, setIsLanguageLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'logs' | 'config'>('logs');

    // 过滤后的日志
    const filteredLogs = filter
        ? logs.filter(log => log.message.toLowerCase().includes(filter.toLowerCase()))
        : logs;

    // 高亮关键词的函数
    const highlightText = (text: string, highlight: string) => {
        if (!highlight) return text;

        const parts = text.split(new RegExp(`(${highlight})`, 'gi'));
        return parts.map((part, index) =>
            part.toLowerCase() === highlight.toLowerCase() ? (
                <span key={index} className="bg-yellow-200 dark:bg-yellow-600 px-1 rounded">
                    {part}
                </span>
            ) : part
        );
    };

    // await initLanguage();

    useEffect(() => {
        const fn = async () => {
            try {
                await initLanguage();
            } finally {
                setIsLanguageLoading(false);
            }
        }
        fn();
    }, []);

    useEffect(() => {
        const unlisten = listen('core_backend', (event) => {
            const message = event.payload as string;
            const newLog: LogEntry = {
                message,
                timestamp: new Date().toTimeString().split(' ')[0], // 获取当前时间的时分秒
            };
            setLogs(prev => [...prev, newLog]);
        });



        return () => {
            unlisten.then(fn => fn());
        };
    }, []);

    // 监听滚动事件，判断是否要启用自动滚动
    useEffect(() => {
        const container = logContainerRef.current;
        if (!container) return;

        const handleScroll = () => {
            const { scrollTop, scrollHeight, clientHeight } = container;
            const isAtBottom = scrollHeight - scrollTop - clientHeight < 5;
            setAutoScroll(isAtBottom);
        };

        container.addEventListener('scroll', handleScroll);
        return () => container.removeEventListener('scroll', handleScroll);
    }, []);

    // 自动滚动到底部
    useEffect(() => {
        if (autoScroll && logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [filteredLogs, autoScroll]);

    // 如果语言还在初始化中，显示loading
    if (isLanguageLoading) {
        return (
            <div className="flex items-center justify-center h-screen">
                <div className="text-center">
                    <span className="loading loading-spinner loading-lg"></span>
                    <div className="mt-4 text-base-content/70">Loading...</div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            <div className="sticky top-0 z-10 bg-base-100 px-2">
                <div className="tabs tabs-bordered">
                    <a
                        className={`tab ${activeTab === 'logs' ? 'tab-active' : ''}`}
                        onClick={() => setActiveTab('logs')}
                    >
                        {t("log_viewer")}
                    </a>
                    <a
                        className={`tab ${activeTab === 'config' ? 'tab-active' : ''}`}
                        onClick={() => setActiveTab('config')}
                    >
                        {t("config_viewer") || "配置查看器"}
                    </a>
                </div>
            </div>

            {/* 日志标签页内容 */}
            <div className={`flex-1 flex flex-col  ${activeTab === 'logs' ? '' : 'hidden'}`} role="tabpanel">
                <div className="flex items-center justify-end mb-4 space-x-4">
                    <div className="flex items-center space-x-2">
                        <input
                            type="text"
                            value={filter}
                            onChange={(e) => setFilter(e.target.value)}
                            placeholder={t("filter_placeholder") || "过滤关键词..."}
                            className="input input-bordered input-sm w-full max-w-xs"
                        />
                        {filter && (
                            <button
                                onClick={() => setFilter('')}
                                className="btn btn-ghost btn-sm"
                                title={t("clear_filter") || "清除过滤"}
                            >
                                ✕
                            </button>
                        )}
                    </div>
                    <label className="label cursor-pointer">
                        <input
                            type="checkbox"
                            checked={autoScroll}
                            onChange={(e) => setAutoScroll(e.target.checked)}
                            className="checkbox checkbox-sm"
                        />
                        <span className="label-text ml-2">{t("auto_scroll")}</span>
                    </label>
                    <button
                        onClick={() => setLogs([])}
                        className="btn btn-ghost btn-sm"
                    >
                        {t("clear_log")}
                    </button>
                </div>

                <div
                    ref={logContainerRef}
                    className="flex-1 rounded-lg border border-base-300 bg-base-200 font-mono overflow-auto"
                >
                    <div className="p-4">
                        {filteredLogs.length === 0 ? (
                            <div className="text-center text-base-content/60 py-8">
                                {filter ? (
                                    <div>
                                        <div>{t("no_matching_logs") || "没有匹配的日志记录"}</div>
                                        <div className="text-xs mt-2">过滤条件: "{filter}"</div>
                                    </div>
                                ) : (
                                    t("no_log_records")
                                )}
                            </div>
                        ) : (
                            filteredLogs.map((log, index) => (
                                <div
                                    key={`${log.timestamp}-${index}`}
                                    className="flex items-start text-xs mb-1"
                                >
                                    <span className="text-base-content/60 flex-shrink-0 mr-3">
                                        {log.timestamp}
                                    </span>
                                    <span className="text-base-content whitespace-pre-wrap">
                                        {highlightText(log.message, filter)}
                                    </span>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* 配置标签页内容 */}
            <div className={`flex-1 ${activeTab === 'config' ? '' : 'hidden'}`} role="tabpanel">
                <ConfigViewer />
            </div>
        </div>
    );
}