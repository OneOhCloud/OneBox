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

                <a
                    className={`tab tab-md ${activeTab === 'config-template' ? 'tab-active' : ''}`}
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
