import { type } from '@tauri-apps/plugin-os';
import { useEffect, useRef, useState } from 'react';
import ConfigViewer from '../components/config-viewer/config-viewer';
import EmptyLogMessage from '../components/log/empty-log-message';
import LogTable from '../components/log/log-table';
import LogTabs from '../components/log/log-tabs';
import { LogSourceType, useLogSource } from '../hooks/useLogSource';
import { initLanguage } from "../utils/helper";

export default function LogPage() {
    const osType = type();
    const [filter, setFilter] = useState('');
    const [autoScroll, setAutoScroll] = useState(true);
    const logContainerRef = useRef<HTMLDivElement>(null);
    const [isLanguageLoading, setIsLanguageLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'logs' | 'config'>('logs');
    const [logSource, setLogSource] = useState<LogSourceType>(osType === 'windows' ? 'api' : 'tauri');
    const { logs, clearLogs } = useLogSource(logSource);

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

    // 日志源的逻辑已移至 useLogSource hook

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
        <div className="flex flex-col h-full px-4 py-2 bg-gray-100">
            <LogTabs
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                filter={filter}
                setFilter={setFilter}
                logSource={logSource}
                setLogSource={setLogSource}
                autoScroll={autoScroll}
                setAutoScroll={setAutoScroll}
                clearLogs={clearLogs}
            />

            {/* 日志标签页内容 */}
            <div className={`flex-1 flex flex-col ${activeTab === 'logs' ? '' : 'hidden'}`} role="tabpanel">
                <div
                    ref={logContainerRef}
                    className="flex-1 rounded-xl border border-base-300 bg-base-200 font-mono overflow-y-auto h-[calc(100dvh-60px)] shadow-inner"
                >
                    <div className="p-4 h-full">
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
                </div>
            </div>

            {/* 配置标签页内容 */}
            <div className={`flex-1 ${activeTab === 'config' ? '' : 'hidden'}`} role="tabpanel">
                <div className="h-[calc(100dvh-60px)] overflow-y-auto overflow-x-hidden">
                    <ConfigViewer />
                </div>
            </div>
        </div>
    );
}