import { ChatText, FunnelFill } from "react-bootstrap-icons";
import { t } from "../../utils/helper";

interface EmptyLogMessageProps {
    filter: string;
}

// Centered empty state. Uses a subdued glyph + one-line hint — Console.app
// leaves the pane empty, but a quiet marker helps orient the user during
// the first seconds after opening the window when there's no traffic yet.
export default function EmptyLogMessage({ filter }: EmptyLogMessageProps) {
    const Icon = filter ? FunnelFill : ChatText;
    return (
        <div className="flex items-center justify-center h-full py-16">
            <div className="flex flex-col items-center gap-3 max-w-sm text-center">
                <Icon
                    size={28}
                    style={{ color: 'var(--onebox-label-tertiary)' }}
                />
                {filter ? (
                    <>
                        <p
                            className="text-[13px] font-medium"
                            style={{ color: 'var(--onebox-label)' }}
                        >
                            {t('no_matching_logs') || '没有匹配的日志记录'}
                        </p>
                        <p
                            className="text-[11px] font-mono"
                            style={{ color: 'var(--onebox-label-secondary)' }}
                        >
                            {filter}
                        </p>
                    </>
                ) : (
                    <p
                        className="text-[13px]"
                        style={{ color: 'var(--onebox-label-secondary)' }}
                    >
                        {t('no_log_records')}
                    </p>
                )}
            </div>
        </div>
    );
}
