import { useState } from "react";
import { ExclamationCircleFill, GlobeAsiaAustralia } from "react-bootstrap-icons";

type AvatarProps = {
    url: string;
    danger: boolean;
};

// 36px rounded-square app-icon tile.
// No hover ring — the row itself provides hit feedback. Favicon from HTTPS
// official_website, globe fallback, red warning tile for over-quota state.
export default function Avatar({ url, danger }: AvatarProps) {
    const [faviconFailed, setFaviconFailed] = useState(false);
    const isHttpsUrl = url && url.startsWith("https");
    const faviconUrl = isHttpsUrl ? `${url}/favicon.ico` : null;

    if (danger) {
        return (
            <div
                className="size-9 rounded-[10px] flex items-center justify-center shrink-0"
                style={{ background: "rgba(255, 59, 48, 0.12)" }}
            >
                <ExclamationCircleFill size={18} style={{ color: "#FF3B30" }} />
            </div>
        );
    }

    return (
        <div
            className="size-9 rounded-[10px] flex items-center justify-center overflow-hidden shrink-0"
            style={{ background: "rgba(118, 118, 128, 0.12)" }}
        >
            {faviconUrl && !faviconFailed ? (
                <img
                    src={faviconUrl}
                    alt=""
                    className="size-full object-cover"
                    loading="lazy"
                    onError={() => setFaviconFailed(true)}
                />
            ) : (
                <GlobeAsiaAustralia
                    size={18}
                    style={{ color: "rgba(60, 60, 67, 0.4)" }}
                />
            )}
        </div>
    );
}
