import clsx from "clsx";
import { Power } from "react-bootstrap-icons";

type ConnectionPhase = "idle" | "connecting" | "on";

type PowerToggleProps = {
    isRunning: boolean;
    isLoading: boolean;
    onClick: () => void;
};

// iOS 26 Liquid Glass power tile.
//
// No halos, no rotating spinners, no breathing pulses. Depth comes entirely
// from static optical layers (specular highlight, inset edge darkening,
// ambient + contact shadows). State changes are a single CSS transition on
// background + shadow. The connecting state is indicated through text and a
// slow dot pulse below — not through any motion on the tile itself.
export function PowerToggle({ isRunning, isLoading, onClick }: PowerToggleProps) {
    const phase: ConnectionPhase = isLoading
        ? "connecting"
        : isRunning
            ? "on"
            : "idle";

    return (
        <button
            type="button"
            onClick={onClick}
            disabled={isLoading}
            aria-pressed={isRunning}
            aria-label="Toggle connection"
            className={clsx(
                "onebox-tile",
                "relative grid place-items-center",
                "size-40 rounded-[44px]",
                "disabled:cursor-not-allowed",
                `onebox-tile--${phase}`,
            )}
        >
            <Power
                size={44}
                className="relative z-[1] transition-colors duration-300 ease-out"
                style={{
                    color:
                        phase === "on"
                            ? "#FFFFFF"
                            : phase === "connecting"
                                ? "var(--onebox-blue)"
                                : "rgba(60, 60, 67, 0.4)",
                }}
            />
        </button>
    );
}
