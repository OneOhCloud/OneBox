import { t } from "../../utils/helper";

interface EmptyLogMessageProps {
    filter: string;
}

export default function EmptyLogMessage({ filter }: EmptyLogMessageProps) {
    return (
        <div className="hero h-full">
            <div className="hero-content text-center">
                <div>
                    {filter ? (
                        <div className="max-w-md">
                            <h2 className="text-xl font-bold mb-2 text-gray-700">{t("no_matching_logs") || "没有匹配的日志记录"}</h2>
                            <div className="text-gray-600">过滤条件: <span className="bg-gray-100 text-gray-700 px-2 py-1 rounded border border-gray-200">{filter}</span></div>
                        </div>
                    ) : (
                        <div className="text-gray-600">{t("no_log_records")}</div>
                    )}
                </div>
            </div>
        </div>
    );
}
