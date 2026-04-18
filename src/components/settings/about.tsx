import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AnimatePresence, motion } from "framer-motion";
import { useContext, useEffect, useState } from "react";
import {
    ChevronRight,
    Clipboard,
    Github,
    Globe,
    InfoCircleFill,
    X,
} from "react-bootstrap-icons";
import { toast } from "sonner";
import { NavContext } from "../../single/context";
import { aboutText } from "../../types/copyright";
import {
    GITHUB_URL,
    OFFICIAL_WEBSITE,
    OsInfo,
} from "../../types/definition";
import {
    formatOsInfo,
    getOsInfo,
    getSingBoxUserAgent,
    t,
} from "../../utils/helper";
import oneboxLogoUrl from "../../assets/onebox-logo.png";
import { Portal } from "../common/portal";
import { SettingItem } from "./common";

const getVersion = async () => {
    const version = await invoke<string>("version");
    return version;
};

/**
 * iOS-style About sheet.
 *
 * Hero: app-icon tile in the systemBlue gradient + app name + version.
 * Section 1 — Device info: grouped-card rows (OS, kernel tappable to show
 * the raw version dump, User-Agent tappable to copy).
 * Section 2 — Links: website + GitHub rows with chevrons.
 * Footer: small copyright blob, then a developer-options escape hatch.
 *
 * Nested `CoreInfoSheet` replaces the old `<dialog>` element to keep
 * z-index and styling under the same roof as the rest of the About UI.
 */
export default function AboutItem() {
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        if (isOpen) {
            document.body.classList.add("overflow-hidden");
        } else {
            document.body.classList.remove("overflow-hidden");
        }
        return () => {
            document.body.classList.remove("overflow-hidden");
        };
    }, [isOpen]);

    return (
        <>
            <SettingItem
                icon={<InfoCircleFill className="text-[#007AFF]" size={22} />}
                title={t("about")}
                onPress={() => setIsOpen(true)}
            />
            {isOpen && <AboutSheet onClose={() => setIsOpen(false)} />}
        </>
    );
}

function AboutSheet({ onClose }: { onClose: () => void }) {
    const [osInfo, setOsInfo] = useState<OsInfo>({
        appVersion: "",
        osArch: "x86",
        osType: "windows",
        osVersion: "",
        osLocale: "",
    });
    const [ua, setUa] = useState<string>("");
    const [versionDump, setVersionDump] = useState<string>("");
    const [coreVersion, setCoreVersion] = useState<string>("");
    const [showCoreInfo, setShowCoreInfo] = useState(false);
    const { setActiveScreen } = useContext(NavContext);

    useEffect(() => {
        getOsInfo().then(setOsInfo).catch(console.error);
        getSingBoxUserAgent().then(setUa).catch(console.error);
        getVersion()
            .then((v) => {
                try {
                    const core = v.split("\n")[0].trim().split(" ")[2]?.trim() ?? "";
                    setCoreVersion(core);
                } catch {
                    // fall back to empty core version
                }
                setVersionDump(v);
            })
            .catch(console.error);
    }, []);

    const copyUa = () => {
        toast.promise(navigator.clipboard.writeText(ua), {
            loading: t("copying"),
            success: t("copy_success"),
            error: t("copy_error"),
        });
    };

    return (
        <Portal>
            <AnimatePresence>
                <motion.div
                    key="about-sheet"
                    className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-3 pb-3"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18 }}
                >
                    <div
                        className="absolute inset-0"
                        style={{
                            background: "rgba(15, 23, 42, 0.42)",
                            backdropFilter: "blur(6px)",
                            WebkitBackdropFilter: "blur(6px)",
                        }}
                        onClick={onClose}
                    />
                    <motion.div
                        className="relative w-full max-w-[340px] rounded-[18px] overflow-hidden flex flex-col"
                        style={{
                            maxHeight: "calc(100dvh - 80px)",
                            background: 'var(--onebox-bg)',
                            boxShadow:
                                "0 22px 48px -12px rgba(15, 23, 42, 0.32), 0 4px 14px rgba(15, 23, 42, 0.08)",
                        }}
                        initial={{ y: 24, opacity: 0, scale: 0.96 }}
                        animate={{ y: 0, opacity: 1, scale: 1 }}
                        exit={{ y: 12, opacity: 0, scale: 0.98 }}
                        transition={{
                            duration: 0.26,
                            ease: [0.32, 0.72, 0, 1],
                        }}
                    >
                        {/* Title bar */}
                        <div
                            className="relative flex items-center justify-center h-11 shrink-0"
                            style={{ background: 'var(--onebox-card)' }}
                        >
                            <h3
                                className="text-[15px] font-semibold tracking-[-0.01em] capitalize"
                                style={{ color: "var(--onebox-label)" }}
                            >
                                {t("about")}
                            </h3>
                            <button
                                type="button"
                                onClick={onClose}
                                className="absolute right-2 top-2 size-7 rounded-full flex items-center justify-center transition-colors active:bg-[rgba(60,60,67,0.08)]"
                                aria-label={t("close")}
                            >
                                <X
                                    size={18}
                                    style={{
                                        color: "var(--onebox-label-secondary)",
                                    }}
                                />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto">
                            {/* Hero */}
                            <div
                                className="flex flex-col items-center pt-6 pb-7"
                                style={{ background: 'var(--onebox-card)' }}
                            >
                                {/* 72px squircle tile. The source PNG has ~22 px
                                    of transparent padding on every side (content
                                    bbox 212×212 / 256×256), which reads as a
                                    visible ring of window background around the
                                    blue icon. Wrap in an overflow-hidden container
                                    and scale the <img> past the container bounds
                                    so the transparent ring is clipped out — the
                                    visible outline is the container's rounded
                                    mask, filled edge-to-edge with icon blue.
                                    Shadow is a low-alpha systemBlue glow (two
                                    layers: broad halo + tight seat) to avoid
                                    competing with the hero's centre of mass. */}
                                <div
                                    className="size-[72px] rounded-[20px] overflow-hidden mb-3.5"
                                    style={{
                                        boxShadow:
                                            '0 14px 34px -10px rgba(10, 132, 255, 0.35), 0 3px 8px rgba(10, 132, 255, 0.14)',
                                    }}
                                >
                                    <img
                                        src={oneboxLogoUrl}
                                        alt="OneBox"
                                        className="size-full"
                                        style={{ transform: 'scale(1.25)' }}
                                    />
                                </div>
                                <h2
                                    className="text-[22px] font-semibold tracking-[-0.02em]"
                                    style={{ color: "var(--onebox-label)" }}
                                >
                                    OneBox
                                </h2>
                                <p
                                    className="text-[13px] mt-1"
                                    style={{
                                        color: "var(--onebox-label-secondary)",
                                    }}
                                >
                                    {t("version")} {osInfo.appVersion}
                                </p>
                            </div>

                            <div className="px-4 pt-5 pb-5 space-y-5">
                                {/* Device info */}
                                <section>
                                    <SectionLabel>{t("system_info")}</SectionLabel>
                                    <div className="onebox-grouped-card">
                                        <InfoRow
                                            label={t("os")}
                                            value={formatOsInfo(
                                                osInfo.osType,
                                                osInfo.osArch,
                                            )}
                                        />
                                        <InfoRow
                                            label={t("kernel_version")}
                                            value={coreVersion}
                                            chevron
                                            onPress={() => setShowCoreInfo(true)}
                                        />
                                        <UaRow ua={ua} onCopy={copyUa} />
                                    </div>
                                </section>

                                {/* Links */}
                                <section>
                                    <SectionLabel>{t("copyright")}</SectionLabel>
                                    <div className="onebox-grouped-card">
                                        <LinkRow
                                            icon={
                                                <Globe
                                                    size={18}
                                                    style={{
                                                        color: "var(--onebox-blue)",
                                                    }}
                                                />
                                            }
                                            label="Website"
                                            onPress={() => openUrl(OFFICIAL_WEBSITE)}
                                        />
                                        <LinkRow
                                            icon={
                                                <Github
                                                    size={18}
                                                    style={{
                                                        color: "var(--onebox-blue)",
                                                    }}
                                                />
                                            }
                                            label="GitHub"
                                            onPress={() => openUrl(GITHUB_URL)}
                                        />
                                    </div>
                                </section>

                                {/* Copyright text */}
                                <div
                                    className="rounded-[14px] px-3 py-2.5 text-[11px] leading-relaxed"
                                    style={{
                                        background: "rgba(118, 118, 128, 0.08)",
                                        color: "var(--onebox-label-secondary)",
                                    }}
                                >
                                    <pre className="whitespace-pre-wrap overflow-x-auto font-sans">
                                        {aboutText}
                                    </pre>
                                </div>

                                {/* Dev-options escape */}
                                <button
                                    type="button"
                                    onClick={() => {
                                        setActiveScreen("developer_options");
                                        onClose();
                                    }}
                                    className="w-full h-10 rounded-[12px] text-[13px] font-medium transition-colors active:bg-[rgba(60,60,67,0.06)]"
                                    style={{
                                        background: "var(--onebox-card)",
                                        color: "var(--onebox-label)",
                                        boxShadow: "var(--onebox-shadow-card)",
                                    }}
                                >
                                    {t("developer_options")}
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            </AnimatePresence>

            {showCoreInfo && (
                <CoreInfoSheet
                    versionDump={versionDump}
                    onClose={() => setShowCoreInfo(false)}
                />
            )}
        </Portal>
    );
}

// ---- Pieces --------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <h4
            className="px-4 mb-1.5 text-[11px] font-semibold uppercase tracking-[0.04em]"
            style={{ color: "var(--onebox-label-secondary)" }}
        >
            {children}
        </h4>
    );
}

function InfoRow({
    label,
    value,
    chevron,
    onPress,
}: {
    label: string;
    value: string;
    chevron?: boolean;
    onPress?: () => void;
}) {
    const Tag: any = onPress ? "button" : "div";
    return (
        <Tag
            onClick={onPress}
            className={`w-full flex items-center gap-3 px-4 py-2.5 text-left ${
                onPress
                    ? "transition-colors active:bg-[rgba(60,60,67,0.04)]"
                    : ""
            }`}
        >
            <span
                className="flex-1 min-w-0 text-[14px] tracking-[-0.005em] capitalize truncate"
                style={{ color: "var(--onebox-label)" }}
            >
                {label}
            </span>
            <span
                className="text-[13px] tracking-[-0.005em] truncate"
                style={{ color: "var(--onebox-label-secondary)" }}
            >
                {value}
            </span>
            {chevron && (
                <ChevronRight
                    size={13}
                    style={{ color: "rgba(60, 60, 67, 0.28)" }}
                />
            )}
        </Tag>
    );
}

function UaRow({ ua, onCopy }: { ua: string; onCopy: () => void }) {
    return (
        <button
            type="button"
            onClick={onCopy}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors active:bg-[rgba(60,60,67,0.04)]"
        >
            <span
                className="shrink-0 text-[14px] tracking-[-0.005em] capitalize"
                style={{ color: "var(--onebox-label)" }}
            >
                User-Agent
            </span>
            <span
                className="flex-1 min-w-0 text-right text-[11px] truncate font-mono"
                style={{ color: "var(--onebox-label-secondary)" }}
            >
                {ua}
            </span>
            <Clipboard
                size={13}
                style={{ color: "rgba(60, 60, 67, 0.35)" }}
            />
        </button>
    );
}

function LinkRow({
    icon,
    label,
    onPress,
}: {
    icon: React.ReactNode;
    label: string;
    onPress: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onPress}
            className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors active:bg-[rgba(60,60,67,0.04)]"
        >
            <div className="size-7 flex items-center justify-center shrink-0">
                {icon}
            </div>
            <span
                className="flex-1 min-w-0 text-[15px] tracking-[-0.005em]"
                style={{ color: "var(--onebox-label)" }}
            >
                {label}
            </span>
            <ChevronRight
                size={13}
                style={{ color: "rgba(60, 60, 67, 0.28)" }}
            />
        </button>
    );
}

function CoreInfoSheet({
    versionDump,
    onClose,
}: {
    versionDump: string;
    onClose: () => void;
}) {
    return (
        <AnimatePresence>
            <motion.div
                key="core-info"
                className="fixed inset-0 z-[60] flex items-center justify-center px-4"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
            >
                <div
                    className="absolute inset-0"
                    style={{
                        background: "rgba(15, 23, 42, 0.4)",
                        backdropFilter: "blur(6px)",
                        WebkitBackdropFilter: "blur(6px)",
                    }}
                    onClick={onClose}
                />
                <motion.div
                    className="relative w-full max-w-[320px] rounded-[14px] overflow-hidden flex flex-col"
                    style={{
                        maxHeight: "calc(100dvh - 100px)",
                        background: 'var(--onebox-card)',
                        boxShadow:
                            "0 22px 48px -12px rgba(15, 23, 42, 0.3), 0 4px 14px rgba(15, 23, 42, 0.08)",
                    }}
                    initial={{ scale: 0.94, y: 8 }}
                    animate={{ scale: 1, y: 0 }}
                    exit={{ scale: 0.96, y: 4 }}
                    transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
                >
                    <h3
                        className="text-[16px] font-semibold text-center pt-4 pb-3 px-5 tracking-[-0.01em] capitalize"
                        style={{ color: "var(--onebox-label)" }}
                    >
                        {t("core_info")}
                    </h3>
                    <div className="flex-1 overflow-y-auto px-4 pb-4">
                        <div
                            className="rounded-xl px-3 py-2.5 text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-all"
                            style={{
                                background: "rgba(118, 118, 128, 0.08)",
                                color: "var(--onebox-label-secondary)",
                            }}
                        >
                            {versionDump}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="w-full h-11 text-[14px] font-semibold transition-colors active:bg-[rgba(0,122,255,0.08)] shrink-0"
                        style={{
                            color: "var(--onebox-blue)",
                            borderTop: "0.5px solid var(--onebox-separator)",
                        }}
                    >
                        {t("close")}
                    </button>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}
