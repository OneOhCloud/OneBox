import { t } from "../../utils/helper";
import LogFilter from "./log-filter";

interface LogTabsProps {
    activeTab: 'logs' | 'config';
    setActiveTab: (tab: 'logs' | 'config') => void;
    filter: string;
    setFilter: (filter: string) => void;
    logSource: 'tauri' | 'api';
    setLogSource: (source: 'tauri' | 'api') => void;
    autoScroll: boolean;
    setAutoScroll: (autoScroll: boolean) => void;
    clearLogs: () => void;
}

export default function LogTabs({
    activeTab,
    setActiveTab,
    filter,
    setFilter,
    logSource,
    setLogSource,
    autoScroll,
    setAutoScroll,
    clearLogs
}: LogTabsProps) {
    return (
        <div className="sticky top-0 z-10 bg-gray-200 mb-2 rounded-md">
            <div className="tabs tabs-lifted">
                <a
                    className={`tab tab-md ${activeTab === 'logs' ? 'tab-active' : ''}`}
                    onClick={() => setActiveTab('logs')}
                >
                    {t("log_viewer")}
                </a>
                <a
                    className={`tab tab-md ${activeTab === 'config' ? 'tab-active' : ''}`}
                    onClick={() => setActiveTab('config')}
                >
                    {t("config_viewer") || "配置查看器"}
                </a>

                {/* 工具栏在标签栏右侧 */}
                {activeTab === 'logs' && (
                    <LogFilter
                        filter={filter}
                        setFilter={setFilter}
                        logSource={logSource}
                        setLogSource={setLogSource}
                        autoScroll={autoScroll}
                        setAutoScroll={setAutoScroll}
                        clearLogs={clearLogs}
                    />
                )}
            </div>
        </div>
    );
}
