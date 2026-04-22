import { formatNetworkSpeed, useNetworkSpeed } from "../../utils/clash-api";

type NetworkSpeedProps = {
    isRunning: boolean;
};

export default function NetworkSpeed({ isRunning }: NetworkSpeedProps) {
    const speed = useNetworkSpeed(isRunning);

    if (!isRunning) return null;

    return (
        <div
            className="flex items-center gap-3 justify-center text-[12px] tabular-nums"
            style={{ color: 'var(--onebox-label-secondary)' }}
        >
            <span className="inline-block w-24 text-right">↑ {formatNetworkSpeed(speed.upload)}</span>
            <span className="inline-block w-24 text-left">↓ {formatNetworkSpeed(speed.download)}</span>
        </div>
    );
}
