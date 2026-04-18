import bytes from "bytes";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import {
    ArrowClockwise,
    Check,
    ChevronRight,
    ClipboardCheck,
    Clipboard as ClipboardIcon,
    Globe,
    PencilSquare,
    Trash3,
    X,
} from "react-bootstrap-icons";
import { toast } from "sonner";
import { mutate } from "swr";
import { deleteSubscription, getSubscriptionConfig, renameSubscription } from "../../action/db";
import { useUpdateSubscription } from "../../action/subscription-hooks";
import { GET_SUBSCRIPTIONS_LIST_SWR_KEY, Subscription } from "../../types/definition";
import { t } from "../../utils/helper";
import { Portal } from "../common/portal";
import Avatar from "./avatar";

interface SubscriptionDetailModalProps {
    item: Subscription | null;
    isOpen: boolean;
    onClose: () => void;
}

const LOCAL_FILE_SENTINEL = 32503680000000;

// Relative-time helper. `Intl.RelativeTimeFormat` with `numeric: 'auto'` gives
// us "just now" / "刚刚" automatically for the <60s case.
function formatRelative(ts: number, locale: string): string {
    const diffMs = ts - Date.now();
    const abs = Math.abs(diffMs);
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    if (abs < 60_000) return rtf.format(Math.round(diffMs / 1000), 'second');
    if (abs < 3_600_000) return rtf.format(Math.round(diffMs / 60_000), 'minute');
    if (abs < 86_400_000) return rtf.format(Math.round(diffMs / 3_600_000), 'hour');
    return rtf.format(Math.round(diffMs / 86_400_000), 'day');
}

function formatAbsolute(ts: number, locale: string): string {
    try {
        return new Date(ts).toLocaleString(locale, {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return new Date(ts).toISOString();
    }
}

// Detail sheet for a single subscription. Layout follows the iOS
// "Settings → item → detail" pattern adapted to a 371 px centered modal:
// hero zone up top (avatar + inline-editable name + website link),
// three grouped-list cards below (用量 / 链接 / 操作), and an isolated
// red Delete card at the bottom so the destructive action has breathing
// room from the rest.
export function SubscriptionDetailModal({
    item,
    isOpen,
    onClose,
}: SubscriptionDetailModalProps) {
    const [nameDraft, setNameDraft] = useState('');
    const [isEditingName, setIsEditingName] = useState(false);
    const [savingName, setSavingName] = useState(false);
    const [copiedUrl, setCopiedUrl] = useState(false);
    const [copiedConfig, setCopiedConfig] = useState(false);
    const [copyingConfig, setCopyingConfig] = useState(false);
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const nameInputRef = useRef<HTMLInputElement>(null);

    const { update, loading: updating } = useUpdateSubscription();

    // Reset all transient state whenever the modal opens for a (possibly
    // different) item. Also seed the name draft from the freshest item
    // payload — SWR may have refreshed since the row was mounted.
    useEffect(() => {
        if (!isOpen || !item) return;
        setNameDraft(item.name);
        setIsEditingName(false);
        setCopiedUrl(false);
        setCopiedConfig(false);
        setConfirmingDelete(false);
    }, [isOpen, item?.identifier]);

    // Auto-focus the name input when edit mode turns on.
    useEffect(() => {
        if (isEditingName) {
            nameInputRef.current?.focus();
            nameInputRef.current?.select();
        }
    }, [isEditingName]);

    if (!item) return null;

    const usage = item.total_traffic > 0
        ? Math.min(100, Math.floor((item.used_traffic / item.total_traffic) * 100))
        : 0;
    const danger = usage >= 100;
    const isLocalFile = item.expire_time === LOCAL_FILE_SENTINEL;
    const remainingDays = Math.floor(
        (item.expire_time - Date.now()) / (1000 * 60 * 60 * 24),
    );
    const locale = typeof navigator !== 'undefined' ? navigator.language : 'en';

    const trafficText = `${bytes(item.used_traffic) ?? '0'} / ${bytes(item.total_traffic) ?? '0'}`;
    const lastUpdateRelative = formatRelative(item.last_update_time, locale);
    const lastUpdateAbsolute = formatAbsolute(item.last_update_time, locale);

    const hasOfficialSite = item.official_website && item.official_website.startsWith('http');

    const nameChanged = nameDraft.trim() && nameDraft.trim() !== item.name;

    const handleSaveName = async () => {
        if (!nameChanged) {
            setIsEditingName(false);
            return;
        }
        setSavingName(true);
        try {
            await renameSubscription(item.identifier, nameDraft);
            await mutate(GET_SUBSCRIPTIONS_LIST_SWR_KEY);
            toast.success(t('name_updated'));
            setIsEditingName(false);
        } catch (e) {
            toast.error(String(e));
        } finally {
            setSavingName(false);
        }
    };

    const handleCopyUrl = async () => {
        try {
            await navigator.clipboard.writeText(item.subscription_url);
            setCopiedUrl(true);
            toast.success(t('subscription_url_copied'));
            setTimeout(() => setCopiedUrl(false), 1500);
        } catch (e) {
            toast.error(t('copy_error'));
        }
    };

    const handleCopyConfig = async () => {
        if (copyingConfig) return;
        setCopyingConfig(true);
        try {
            const config = await getSubscriptionConfig(item.identifier);
            if (!config) {
                toast.error(t('get_subscription_config_failed'));
                return;
            }
            await navigator.clipboard.writeText(JSON.stringify(config, null, 2));
            setCopiedConfig(true);
            toast.success(t('config_content_copied'));
            setTimeout(() => setCopiedConfig(false), 1500);
        } catch (e) {
            toast.error(t('copy_error'));
        } finally {
            setCopyingConfig(false);
        }
    };

    const handleUpdate = async () => {
        await update(item.identifier);
        await mutate(GET_SUBSCRIPTIONS_LIST_SWR_KEY);
    };

    const handleDelete = async () => {
        if (!confirmingDelete) {
            setConfirmingDelete(true);
            // Auto-cancel the confirmation state after 3 s so a stale
            // "tap to confirm" doesn't sit there indefinitely.
            setTimeout(() => setConfirmingDelete(false), 3000);
            return;
        }
        await deleteSubscription(item.identifier);
        await mutate(GET_SUBSCRIPTIONS_LIST_SWR_KEY);
        onClose();
    };

    return (
        <Portal>
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        key="detail-modal"
                        className="fixed inset-0 z-50 flex items-center justify-center px-3"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.18 }}
                    >
                        <div
                            className="absolute inset-0"
                            style={{
                                background: 'rgba(15, 23, 42, 0.42)',
                                backdropFilter: 'blur(6px)',
                                WebkitBackdropFilter: 'blur(6px)',
                            }}
                            onClick={onClose}
                        />
                        <motion.div
                            className="relative w-full max-w-[340px] rounded-[18px] overflow-hidden flex flex-col"
                            style={{
                                maxHeight: 'calc(100dvh - 60px)',
                                background: 'var(--onebox-bg)',
                                boxShadow:
                                    '0 22px 48px -12px rgba(15, 23, 42, 0.32), 0 4px 14px rgba(15, 23, 42, 0.08)',
                            }}
                            initial={{ scale: 0.94, y: 12, opacity: 0 }}
                            animate={{ scale: 1, y: 0, opacity: 1 }}
                            exit={{ scale: 0.96, y: 4, opacity: 0 }}
                            transition={{
                                duration: 0.24,
                                ease: [0.32, 0.72, 0, 1],
                            }}
                        >
                            {/* ── Header ───────────────────────────────── */}
                            <div
                                className="relative flex items-center justify-center h-11 shrink-0"
                                style={{ background: 'var(--onebox-card)' }}
                            >
                                <h3
                                    className="text-[15px] font-semibold tracking-[-0.01em]"
                                    style={{ color: 'var(--onebox-label)' }}
                                >
                                    {t('details')}
                                </h3>
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="absolute right-2 top-2 size-7 rounded-full flex items-center justify-center transition-colors active:bg-[rgba(60,60,67,0.08)]"
                                    aria-label={t('close')}
                                >
                                    <X
                                        size={18}
                                        style={{ color: 'var(--onebox-label-secondary)' }}
                                    />
                                </button>
                            </div>

                            <div className="flex-1 overflow-y-auto">
                                <div className="px-4 pt-5 pb-5 space-y-5">
                                    {/* Unified card: name row (editable, tall, with avatar)
                                        + traffic + expiry + last updated. Keeps the
                                        subscription's identity and metadata in one
                                        visual group — per Apple "About this device"
                                        pattern where the device name headlines the
                                        same grouped list that contains its specs. */}
                                    <section>
                                        <div className="onebox-grouped-card">
                                            {/* Name row — avatar + inline-editable text */}
                                            <div className="px-4 py-3.5 flex items-center gap-3">
                                                <Avatar
                                                    url={item.official_website}
                                                    danger={danger}
                                                />
                                                <div className="flex-1 min-w-0">
                                                    <AnimatePresence mode="wait" initial={false}>
                                                        {isEditingName ? (
                                                            <motion.form
                                                                key="edit"
                                                                className="flex items-center gap-2"
                                                                initial={{ opacity: 0, y: 2 }}
                                                                animate={{ opacity: 1, y: 0 }}
                                                                exit={{ opacity: 0, y: -2 }}
                                                                transition={{ duration: 0.12 }}
                                                                onSubmit={(e) => {
                                                                    e.preventDefault();
                                                                    handleSaveName();
                                                                }}
                                                            >
                                                                <input
                                                                    ref={nameInputRef}
                                                                    type="text"
                                                                    value={nameDraft}
                                                                    onChange={(e) => setNameDraft(e.target.value)}
                                                                    disabled={savingName}
                                                                    onBlur={handleSaveName}
                                                                    className="flex-1 min-w-0 text-[15px] font-medium tracking-[-0.01em] bg-transparent border-0 outline-none"
                                                                    style={{
                                                                        color: 'var(--onebox-label)',
                                                                        borderBottom: '1px solid var(--onebox-blue)',
                                                                        padding: '1px 0',
                                                                    }}
                                                                />
                                                                <button
                                                                    type="submit"
                                                                    disabled={savingName}
                                                                    className="size-5 rounded-full flex items-center justify-center shrink-0"
                                                                    style={{
                                                                        background: 'var(--onebox-blue)',
                                                                        color: '#FFFFFF',
                                                                        opacity: nameChanged ? 1 : 0.4,
                                                                    }}
                                                                    aria-label={t('save')}
                                                                >
                                                                    <Check size={11} />
                                                                </button>
                                                            </motion.form>
                                                        ) : (
                                                            <motion.button
                                                                key="display"
                                                                type="button"
                                                                onClick={() => setIsEditingName(true)}
                                                                className="group w-full flex items-center gap-1.5"
                                                                initial={{ opacity: 0, y: 2 }}
                                                                animate={{ opacity: 1, y: 0 }}
                                                                exit={{ opacity: 0, y: -2 }}
                                                                transition={{ duration: 0.12 }}
                                                            >
                                                                <span
                                                                    className="text-[15px] font-medium tracking-[-0.01em] truncate"
                                                                    style={{
                                                                        color: danger ? '#FF3B30' : 'var(--onebox-label)',
                                                                    }}
                                                                >
                                                                    {item.name}
                                                                </span>
                                                                <PencilSquare
                                                                    size={11}
                                                                    className="opacity-40 group-hover:opacity-80 transition-opacity shrink-0"
                                                                    style={{ color: 'var(--onebox-label-secondary)' }}
                                                                />
                                                            </motion.button>
                                                        )}
                                                    </AnimatePresence>
                                                    {hasOfficialSite && !isEditingName && (
                                                        <a
                                                            href="#"
                                                            onClick={(e) => {
                                                                e.preventDefault();
                                                                import('@tauri-apps/plugin-opener').then(
                                                                    ({ openUrl }) =>
                                                                        openUrl(item.official_website),
                                                                );
                                                            }}
                                                            className="mt-0.5 inline-flex items-center gap-1 text-[11px]"
                                                            style={{ color: 'var(--onebox-blue)' }}
                                                        >
                                                            <Globe size={9} />
                                                            <span className="truncate">
                                                                {(() => {
                                                                    try { return new URL(item.official_website).host; }
                                                                    catch { return item.official_website; }
                                                                })()}
                                                            </span>
                                                        </a>
                                                    )}
                                                </div>
                                            </div>
                                            <InfoRow
                                                label={t('traffic_usage')}
                                                value={trafficText}
                                                tail={
                                                    <ProgressBar
                                                        percent={usage}
                                                        danger={danger}
                                                    />
                                                }
                                            />
                                            <InfoRow
                                                label={t('expired_at')}
                                                value={
                                                    isLocalFile
                                                        ? t('local_file_no_expire')
                                                        : `${formatAbsolute(item.expire_time, locale).split(' ')[0]} · ${remainingDays} ${t('days')}`
                                                }
                                            />
                                            <InfoRow
                                                label={t('last_updated')}
                                                value={lastUpdateRelative}
                                                title={lastUpdateAbsolute}
                                            />
                                        </div>
                                    </section>

                                    {/* Subscription URL — separate card so
                                        the long value can wrap onto two
                                        lines without crowding the stats
                                        grid above. */}
                                    <section>
                                        <div className="onebox-grouped-card">
                                            <div className="px-4 py-3">
                                                <div
                                                    className="text-[12px] mb-1"
                                                    style={{
                                                        color: 'var(--onebox-label-secondary)',
                                                    }}
                                                >
                                                    {t('subscription_url')}
                                                </div>
                                                <div
                                                    className="text-[11.5px] leading-snug break-all onebox-selectable"
                                                    style={{
                                                        fontFamily:
                                                            'ui-monospace, "SF Mono", Menlo, monospace',
                                                        color: 'var(--onebox-label)',
                                                    }}
                                                >
                                                    {item.subscription_url}
                                                </div>
                                            </div>
                                        </div>
                                    </section>

                                    {/* Primary actions */}
                                    <section>
                                        <div className="onebox-grouped-card">
                                            <ActionRow
                                                icon={
                                                    copiedUrl ? (
                                                        <ClipboardCheck
                                                            size={16}
                                                            style={{
                                                                color: 'var(--onebox-green)',
                                                            }}
                                                        />
                                                    ) : (
                                                        <ClipboardIcon
                                                            size={16}
                                                            style={{
                                                                color: 'var(--onebox-blue)',
                                                            }}
                                                        />
                                                    )
                                                }
                                                label={t('copy_subscription_url')}
                                                onPress={handleCopyUrl}
                                            />
                                            <ActionRow
                                                icon={
                                                    copiedConfig ? (
                                                        <ClipboardCheck
                                                            size={16}
                                                            style={{
                                                                color: 'var(--onebox-green)',
                                                            }}
                                                        />
                                                    ) : (
                                                        <ClipboardIcon
                                                            size={16}
                                                            style={{
                                                                color: 'var(--onebox-blue)',
                                                            }}
                                                        />
                                                    )
                                                }
                                                label={t('copy_config_content')}
                                                onPress={handleCopyConfig}
                                                loading={copyingConfig}
                                            />
                                            <ActionRow
                                                icon={
                                                    <motion.div
                                                        animate={
                                                            updating
                                                                ? { rotate: 360 }
                                                                : { rotate: 0 }
                                                        }
                                                        transition={
                                                            updating
                                                                ? {
                                                                      duration: 1,
                                                                      repeat: Infinity,
                                                                      ease: 'linear',
                                                                  }
                                                                : undefined
                                                        }
                                                    >
                                                        <ArrowClockwise
                                                            size={16}
                                                            style={{
                                                                color: 'var(--onebox-blue)',
                                                            }}
                                                        />
                                                    </motion.div>
                                                }
                                                label={
                                                    updating
                                                        ? t('updating')
                                                        : t('refresh_now')
                                                }
                                                onPress={handleUpdate}
                                                disabled={updating}
                                            />
                                        </div>
                                    </section>

                                    {/* Destructive — isolated card so a
                                        red-glyph row doesn't visually
                                        pool with the blue-glyph primary
                                        actions above. */}
                                    <section>
                                        <div className="onebox-grouped-card">
                                            <button
                                                type="button"
                                                onClick={handleDelete}
                                                className="w-full flex items-center justify-center gap-2 px-4 py-3 text-[14px] font-medium transition-colors active:bg-[rgba(255,59,48,0.08)]"
                                                style={{ color: '#FF3B30' }}
                                            >
                                                <Trash3 size={15} />
                                                <span>
                                                    {confirmingDelete
                                                        ? t('confirm') +
                                                          ' ' +
                                                          t('delete') +
                                                          '?'
                                                        : t('delete')}
                                                </span>
                                            </button>
                                        </div>
                                    </section>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </Portal>
    );
}

// ── Internal subcomponents ─────────────────────────────────────────

function InfoRow({
    label,
    value,
    tail,
    title,
}: {
    label: string;
    value: string;
    tail?: React.ReactNode;
    title?: string;
}) {
    return (
        <div className="px-4 py-3" title={title}>
            <div className="flex items-center justify-between gap-3">
                <span
                    className="text-[14px] tracking-[-0.005em] shrink-0"
                    style={{ color: 'var(--onebox-label)' }}
                >
                    {label}
                </span>
                <span
                    className="text-[13px] truncate tabular-nums"
                    style={{ color: 'var(--onebox-label-secondary)' }}
                >
                    {value}
                </span>
            </div>
            {tail && <div className="mt-2">{tail}</div>}
        </div>
    );
}

function ProgressBar({ percent, danger }: { percent: number; danger: boolean }) {
    return (
        <div
            className="h-1 rounded-full overflow-hidden"
            style={{ background: 'rgba(60, 60, 67, 0.12)' }}
        >
            <div
                className="h-full rounded-full"
                style={{
                    width: `${percent}%`,
                    background: danger ? '#FF3B30' : 'var(--onebox-blue)',
                    transition: 'width 400ms cubic-bezier(0.32, 0.72, 0, 1)',
                }}
            />
        </div>
    );
}

function ActionRow({
    icon,
    label,
    onPress,
    disabled,
    loading,
}: {
    icon: React.ReactNode;
    label: string;
    onPress: () => void;
    disabled?: boolean;
    loading?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onPress}
            disabled={disabled || loading}
            className="w-full flex items-center gap-3 px-4 py-3 transition-colors disabled:opacity-50 active:bg-[rgba(0,122,255,0.06)]"
        >
            <div className="size-6 flex items-center justify-center shrink-0">
                {icon}
            </div>
            <span
                className="flex-1 text-left text-[14px] tracking-[-0.005em]"
                style={{ color: 'var(--onebox-label)' }}
            >
                {label}
            </span>
            <ChevronRight
                size={12}
                className="shrink-0"
                style={{ color: 'rgba(60, 60, 67, 0.3)' }}
            />
        </button>
    );
}
