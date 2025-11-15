import { t } from "../../utils/helper";

interface LogFilterProps {
    filter: string;
    setFilter: (filter: string) => void;
    autoScroll: boolean;
    setAutoScroll: (autoScroll: boolean) => void;
    clearLogs: () => void;
}

export default function LogFilter({
    filter,
    setFilter,
    autoScroll,
    setAutoScroll,
    clearLogs
}: LogFilterProps) {
    return (
        <div className="flex items-center gap-4 ml-auto px-4">
            <div className="join">
                <input
                    type="text"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder={t("filter_placeholder") || "过滤关键词..."}
                    className="input rounded-md input-xs bg-white border-gray-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all duration-200"
                />

            </div>
            <label className="label cursor-pointer gap-2">
                <input
                    type="checkbox"
                    checked={autoScroll}
                    onChange={(e) => setAutoScroll(e.target.checked)}
                    className="toggle toggle-sm toggle-accent"
                />
                <span className="label-text text-gray-700">{t("auto_scroll")}</span>
            </label>
            <button
                onClick={clearLogs}
                className="btn btn-sm bg-white text-gray-700 border-gray-300 hover:bg-gray-100 hover:border-gray-400 transition-all duration-200"
            >
                {t("clear_log")}
            </button>
        </div>
    );
}
