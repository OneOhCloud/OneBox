import { t } from "../../utils/helper";

interface EmptyLogMessageProps {
    filter: string;
}

export default function EmptyLogMessage({ filter }: EmptyLogMessageProps) {
    return (
        <div className="hero h-full  rounded-md">
            <div className="hero-content text-center">
                <div>
                    {filter ? (
                        <div className="max-w-md">
                            <h2 className="text-xl font-bold mb-2">{t("no_matching_logs") || "没有匹配的日志记录"}</h2>
                            <div className="text-base-content/70">过滤条件: <span className="badge badge-neutral">{filter}</span></div>
                        </div>
                    ) : (
                        <div className="text-base-content/70">{t("no_log_records")}</div>
                    )}
                </div>
            </div>
        </div>
    );
}
