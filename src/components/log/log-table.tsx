interface LogEntry {
    message: string;
    timestamp: string;
    type?: string;
    payload?: string;
}

interface LogTableProps {
    logs: LogEntry[];
    filter: string;
    highlightText: (text: string, highlight: string) => React.ReactNode;
}

export default function LogTable({ logs, filter, highlightText }: LogTableProps) {
    return (
        <div className="font-mono text-xs overflow-x-auto">
            {logs.map((log, index) => (
                <div key={`${log.timestamp}-${index}`} className="whitespace-nowrap text-gray-700">
                    <span className="text-gray-500">{log.timestamp}</span> {highlightText(log.message, filter)}
                </div>
            ))}
        </div>
    );
}
