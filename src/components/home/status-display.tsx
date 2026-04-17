import clsx from "clsx";

type StatusDisplayProps = {
    statusText: string;
    phase: "idle" | "connecting" | "on";
};

// iOS 26 status row: a 5px dot (state-tinted, slow pulse only while
// connecting) + a single line of SF Pro Medium. No text fade, no blur
// transition — the dot and label simply recolour on state change.
export function StatusDisplay({ statusText, phase }: StatusDisplayProps) {
    const dotColor =
        phase === "idle"
            ? "rgba(60, 60, 67, 0.3)"
            : "var(--onebox-blue)";

    const textColor =
        phase === "on"
            ? "var(--onebox-label)"
            : phase === "connecting"
                ? "var(--onebox-label)"
                : "var(--onebox-label-secondary)";

    return (
        <div className="inline-flex items-center gap-2 h-5">
            <span
                aria-hidden
                className={clsx(
                    "inline-block size-1.25 rounded-full",
                    "transition-colors duration-300 ease-out",
                    phase === "connecting" && "onebox-dot-pulse",
                )}
                style={{ backgroundColor: dotColor }}
            />
            <span
                className="text-[13px] font-medium leading-none tracking-[-0.01em] capitalize transition-colors duration-300 ease-out"
                style={{ color: textColor }}
            >
                {statusText}
            </span>
        </div>
    );
}
