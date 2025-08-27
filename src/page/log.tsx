import { useEffect, useRef, useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle } from 'react-bootstrap-icons';
import ConfigViewer from '../components/config-viewer/config-viewer';
import EmptyLogMessage from '../components/log/empty-log-message';
import LogTable from '../components/log/log-table';
import LogTabs from '../components/log/log-tabs';

import { formatNetworkSpeed, useLogSource, useNetworkSpeed } from '../utils/clash-api';
import { initLanguage } from "../utils/helper";

export default function LogPage() {
    const [filter, setFilter] = useState('');
    const [autoScroll, setAutoScroll] = useState(true);
    const logContainerRef = useRef<HTMLDivElement>(null);
    const [isLanguageLoading, setIsLanguageLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'logs' | 'config'>('logs');
    const { logs, clearLogs } = useLogSource();
    const speed = useNetworkSpeed();

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
        <div className="flex flex-col  px-4 py-2 bg-gray-100  h-screen">
            <LogTabs
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                filter={filter}
                setFilter={setFilter}

                autoScroll={autoScroll}
                setAutoScroll={setAutoScroll}
                clearLogs={clearLogs}
            />

            {/* 日志标签页内容 */}
            <div className={`flex-1 flex flex-col ${activeTab === 'logs' ? '' : 'hidden'}`} role="tabpanel">


                <div
                    ref={logContainerRef}
                    className="flex-1 rounded-xl border border-base-300 bg-base-200 font-mono overflow-y-auto h-[calc(100dvh-100px)] shadow-inner"
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
                <div className="h-[calc(100dvh-100px)] overflow-y-auto overflow-x-hidden">
                    <ConfigViewer />
                </div>
            </div>

            <div className="flex   justify-end  items-center text-sm  p-2">
                <div className="flex items-center gap-1  ">
                    <ArrowUpCircle size={12} className="text-blue-500" />

                    <div className="font-mono font-medium tracking-tight min-w-[80px] ">
                        <span className="text-blue-600">{formatNetworkSpeed(speed.upload)}</span>
                    </div>

                </div>

                <div className="flex items-center gap-1 text-right justify-end">
                    <div className="font-mono font-medium tracking-tight min-w-[80px]">
                        <span className="text-green-600">{formatNetworkSpeed(speed.download)}</span>
                    </div>
                    <ArrowDownCircle size={12} className="text-green-500" />

                </div>

            </div>
        </div>
    );
}