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
            <label className="swap">
                <div className="swap-on badge badge-primary badge-md">{t("api_logs", "API 日志")}</div>
                <div className="swap-off badge badge-secondary badge-md">{t("tauri_logs", "Tauri 日志")}</div>
            </label>
            <div className="join">
                <input
                    type="text"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder={t("filter_placeholder") || "过滤关键词..."}
                    className="input rounded-md input-xs input-ghost"
                />

            </div>
            <label className="label cursor-pointer gap-2">
                <input
                    type="checkbox"
                    checked={autoScroll}
                    onChange={(e) => setAutoScroll(e.target.checked)}
                    className="toggle toggle-primary toggle-sm"
                />
                <span className="label-text">{t("auto_scroll")}</span>
            </label>
            <button
                onClick={clearLogs}
                className="btn btn-error btn-outline btn-sm"
            >
                {t("clear_log")}
            </button>
        </div>
    );
}
