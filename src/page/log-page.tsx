import { listen } from '@tauri-apps/api/event';
import { useEffect, useRef, useState } from 'react';
import { t } from "../utils/helper";

interface LogEntry {
    message: string;
    timestamp: string;
}

export default function LogPage() {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const logContainerRef = useRef<HTMLDivElement>(null);
    const [autoScroll, setAutoScroll] = useState(true);

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
    }, [logs, autoScroll]);

    return (
        <div className="flex flex-col h-full bg-white dark:bg-gray-900 p-4">
            <div className="flex items-center justify-between mb-4">
                <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                    {/* 日志查看器 */}
                    {t("log_viewer")}
                </h1>
                <div className="flex items-center gap-4">
                    <label className="flex items-center space-x-2 text-sm">
                        <input
                            type="checkbox"
                            checked={autoScroll}
                            onChange={(e) => setAutoScroll(e.target.checked)}
                            className="form-checkbox h-4 w-4"
                        />
                        <span className="text-gray-700 dark:text-gray-300">
                            {/* 自动滚动 */}
                            {t("auto_scroll")}
                        </span>
                    </label>
                    <button
                        onClick={() => setLogs([])}
                        className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-md transition-colors duration-200"
                    >
                        {/* 清除日志 */}
                        {t("clear_log")}
                    </button>
                </div>
            </div>

            <div
                ref={logContainerRef}
                className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 font-mono max-h-[calc(100vh-6rem)] overflow-auto"
            >
                <div className="p-4">
                    {logs.length === 0 ? (
                        <div className="text-center text-gray-500 dark:text-gray-400 py-8">
                            {/* 暂无日志记录 */}
                            {t("no_log_records")}
                        </div>
                    ) : (
                        logs.map((log, index) => (
                            <div
                                key={index}
                                className="flex items-start text-xs mb-1"
                            >
                                <span className="text-gray-500 dark:text-gray-400 flex-shrink-0 mr-3">
                                    {log.timestamp}
                                </span>
                                <span className="text-gray-700 dark:text-gray-300 whitespace-nowrap">
                                    {log.message}
                                </span>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}