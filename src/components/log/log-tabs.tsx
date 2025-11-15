import { t } from "../../utils/helper";
import LogFilter from "./log-filter";


export type TabKeys = 'logs' | 'config' | 'config-template';

interface LogTabsProps {
    activeTab: TabKeys;
    setActiveTab: (tab: TabKeys) => void;
    filter: string;
    setFilter: (filter: string) => void;
    autoScroll: boolean;
    setAutoScroll: (autoScroll: boolean) => void;
    clearLogs: () => void;
}

export default function LogTabs({
    activeTab,
    setActiveTab,
    filter,
    setFilter,
    autoScroll,
    setAutoScroll,
    clearLogs
}: LogTabsProps) {
    return (
        <div className="sticky top-0 z-10 bg-white mb-2 rounded-md border-b border-gray-200">
            <div className="tabs tabs-lifted">
                <a
                    className={`tab tab-md transition-all duration-200 ${activeTab === 'logs' ? 'tab-active bg-white border-b-2 border-blue-600 text-blue-600' : 'text-gray-600 hover:text-blue-600'}`}
                    onClick={() => setActiveTab('logs')}
                >
                    {t("log_viewer")}
                </a>
                <a
                    className={`tab tab-md transition-all duration-200 ${activeTab === 'config' ? 'tab-active bg-white border-b-2 border-blue-600 text-blue-600' : 'text-gray-600 hover:text-blue-600'}`}
                    onClick={() => setActiveTab('config')}
                >
                    {t("config_viewer") || "配置查看器"}
                </a>

                <a
                    className={`tab tab-md transition-all duration-200 ${activeTab === 'config-template' ? 'tab-active bg-white border-b-2 border-blue-600 text-blue-600' : 'text-gray-600 hover:text-blue-600'}`}
                    onClick={() => setActiveTab('config-template')}
                >
                    {t("config_template") || "配置模版"}
                </a>

                {/* 工具栏在标签栏右侧 */}
                {activeTab === 'logs' && (
                    <LogFilter
                        filter={filter}
                        setFilter={setFilter}

                        autoScroll={autoScroll}
                        setAutoScroll={setAutoScroll}
                        clearLogs={clearLogs}
                    />
                )}
            </div>
        </div>
    );
}
