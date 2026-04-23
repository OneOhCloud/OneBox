import { invoke } from '@tauri-apps/api/core';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { CheckCircleFill, XCircleFill } from 'react-bootstrap-icons';
import { t } from '../../utils/helper';

export interface PrestartRepairModalProps {
    visible: boolean;
    orphanPids: number[];
    onSuccess: () => void;
    onClose: () => void;
}

type RepairPhase = 'detecting' | 'killing' | 'verifying' | 'success' | 'failed';
type StepState = 'idle' | 'active' | 'done' | 'error';

const STEP_ROW_HEIGHT_PX = 38;
const CIRCLE_SIZE_PX = 20;
const RAIL_SEGMENT_PX = STEP_ROW_HEIGHT_PX - CIRCLE_SIZE_PX;

const PHASE_STEPS: readonly RepairPhase[] = ['detecting', 'killing', 'verifying'];

function phaseToIndex(phase: RepairPhase): number {
    switch (phase) {
        case 'detecting': return 0;
        case 'killing': return 1;
        case 'verifying': return 2;
        case 'success': return 3;
        default: return -1;
    }
}

function resolveStepState(
    i: number,
    activeIdx: number,
    isDone: boolean,
    isError: boolean,
): StepState {
    if (isDone) return 'done';
    if (isError) {
        if (i < activeIdx) return 'done';
        if (i === activeIdx) return 'error';
        return 'idle';
    }
    if (i < activeIdx) return 'done';
    if (i === activeIdx) return 'active';
    return 'idle';
}

function StepCircle({ state }: { state: StepState }) {
    if (state === 'done') {
        return (
            <CheckCircleFill
                size={CIRCLE_SIZE_PX}
                style={{ color: 'var(--onebox-blue)' }}
            />
        );
    }
    if (state === 'error') {
        return <XCircleFill size={CIRCLE_SIZE_PX} style={{ color: '#FF3B30' }} />;
    }
    if (state === 'active') {
        return (
            <motion.div
                className="relative"
                style={{ width: CIRCLE_SIZE_PX, height: CIRCLE_SIZE_PX }}
                animate={{ opacity: [0.7, 1, 0.7] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
            >
                <div
                    className="absolute inset-0 rounded-full"
                    style={{ background: 'var(--onebox-blue)' }}
                />
                <div
                    className="absolute rounded-full"
                    style={{
                        width: 8,
                        height: 8,
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        background: '#FFFFFF',
                    }}
                />
            </motion.div>
        );
    }
    return (
        <div
            className="rounded-full"
            style={{
                width: CIRCLE_SIZE_PX,
                height: CIRCLE_SIZE_PX,
                background: '#FFFFFF',
                boxShadow: 'inset 0 0 0 1.5px rgba(60, 60, 67, 0.18)',
            }}
        />
    );
}

function StepRow({
    label,
    state,
    isLast,
    railFillPercent,
}: {
    label: string;
    state: StepState;
    isLast: boolean;
    railFillPercent: number;
}) {
    const labelColor =
        state === 'error'
            ? '#FF3B30'
            : state === 'active'
                ? 'var(--onebox-label)'
                : state === 'done'
                    ? 'var(--onebox-label-secondary)'
                    : 'var(--onebox-label-tertiary)';

    const fontWeight = state === 'active' ? 500 : 400;

    return (
        <li
            className="relative flex items-center gap-3 list-none"
            style={{ height: STEP_ROW_HEIGHT_PX }}
        >
            <div
                className="relative z-10 flex items-center justify-center shrink-0"
                style={{ width: CIRCLE_SIZE_PX, height: CIRCLE_SIZE_PX }}
            >
                <StepCircle state={state} />
                {!isLast && (
                    <>
                        <div
                            className="absolute top-full left-1/2 -translate-x-1/2"
                            style={{
                                width: 1.5,
                                height: RAIL_SEGMENT_PX,
                                background: 'rgba(60, 60, 67, 0.14)',
                            }}
                            aria-hidden
                        />
                        <motion.div
                            className="absolute top-full left-1/2 -translate-x-1/2"
                            style={{
                                width: 1.5,
                                background: 'var(--onebox-blue)',
                            }}
                            initial={false}
                            animate={{ height: RAIL_SEGMENT_PX * railFillPercent }}
                            transition={{ duration: 0.4, ease: 'easeOut' }}
                            aria-hidden
                        />
                    </>
                )}
            </div>
            <span
                className="text-[14px] tracking-[-0.005em]"
                style={{ color: labelColor, fontWeight }}
            >
                {label}
            </span>
        </li>
    );
}

function LivenessDots() {
    return (
        <div className="flex items-center gap-1">
            {[0, 1, 2].map((i) => (
                <motion.span
                    key={i}
                    className="block rounded-full"
                    style={{
                        width: 4,
                        height: 4,
                        background: 'rgba(60, 60, 67, 0.3)',
                    }}
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{
                        duration: 1.4,
                        repeat: Infinity,
                        delay: i * 0.18,
                        ease: 'easeInOut',
                    }}
                />
            ))}
        </div>
    );
}

export function PrestartRepairModal({
    visible,
    orphanPids,
    onSuccess,
    onClose,
}: PrestartRepairModalProps) {
    const [phase, setPhase] = useState<RepairPhase>('detecting');
    const hasRun = useRef(false);

    useEffect(() => {
        if (!visible) {
            // Reset for next open
            hasRun.current = false;
            setPhase('detecting');
            return;
        }
        if (hasRun.current) return;
        hasRun.current = true;

        (async () => {
            // Brief dwell in detecting so user sees the step
            await new Promise(r => setTimeout(r, 600));
            setPhase('killing');

            try {
                const result = await invoke<{ success: boolean; port_released: boolean }>('kill_orphans');
                setPhase('verifying');
                // Brief verifying dwell
                await new Promise(r => setTimeout(r, 800));

                if (result.success && result.port_released) {
                    setPhase('success');
                    await new Promise(r => setTimeout(r, 800));
                    onSuccess();
                } else {
                    setPhase('failed');
                }
            } catch {
                setPhase('failed');
            }
        })();
    }, [visible]);

    const isSuccess = phase === 'success';
    const isFailed = phase === 'failed';
    const isTerminal = isSuccess || isFailed;
    const isRunning = !isTerminal;

    const lastRunningIdxRef = useRef(0);
    useEffect(() => {
        const idx = phaseToIndex(phase);
        if (idx >= 0 && idx < PHASE_STEPS.length) lastRunningIdxRef.current = idx;
    }, [phase]);

    const activeIdx = isFailed ? lastRunningIdxRef.current : phaseToIndex(phase);

    const titleText = isFailed
        ? t('prestart_failed', 'Repair failed, please restart your computer')
        : isSuccess
            ? t('prestart_success', 'Repaired, starting service')
            : t('prestart_repair_title', 'Clean Up Orphan Processes');

    return (
        <AnimatePresence>
            {visible && (
                <motion.div
                    key="prestart-repair-modal"
                    className="fixed inset-0 z-50 flex items-center justify-center px-4"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18 }}
                >
                    <div
                        className="absolute inset-0"
                        style={{
                            background: 'rgba(15, 23, 42, 0.38)',
                            backdropFilter: 'blur(6px)',
                            WebkitBackdropFilter: 'blur(6px)',
                        }}
                    />
                    <motion.div
                        className="relative w-full max-w-72.5 rounded-[14px] overflow-hidden"
                        style={{
                            background: 'var(--onebox-card)',
                            boxShadow:
                                '0 22px 48px -12px rgba(15, 23, 42, 0.3), 0 4px 14px rgba(15, 23, 42, 0.08)',
                        }}
                        initial={{ scale: 0.92, y: 8 }}
                        animate={{ scale: 1, y: 0 }}
                        exit={{ scale: 0.94, y: 4 }}
                        transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
                    >
                        <div className="pt-5 px-5 pb-4">
                            {/* Terminal state chip */}
                            {isTerminal && (
                                <div
                                    className="size-11 rounded-xl flex items-center justify-center mx-auto mb-3"
                                    style={{
                                        background: isFailed
                                            ? 'rgba(255, 59, 48, 0.1)'
                                            : 'rgba(52, 199, 89, 0.12)',
                                    }}
                                >
                                    {isFailed ? (
                                        <XCircleFill size={22} style={{ color: '#FF3B30' }} />
                                    ) : (
                                        <CheckCircleFill size={22} style={{ color: '#34C759' }} />
                                    )}
                                </div>
                            )}

                            <h3
                                className="text-[16px] font-semibold text-center tracking-[-0.01em] mb-4"
                                style={{ color: 'var(--onebox-label)' }}
                            >
                                {titleText}
                            </h3>

                            {/* PID pill list */}
                            {orphanPids.length > 0 && !isTerminal && (
                                <div className="flex flex-wrap gap-1.5 mb-4">
                                    {orphanPids.map((pid) => (
                                        <span
                                            key={pid}
                                            className="text-[11px] px-2 py-0.5 rounded-full"
                                            style={{
                                                background: 'rgba(60, 60, 67, 0.08)',
                                                color: 'var(--onebox-label-secondary)',
                                            }}
                                        >
                                            {t('prestart_pid_label', 'Orphan process')} {pid}
                                        </span>
                                    ))}
                                </div>
                            )}

                            <ol className="relative m-0 p-0 pl-1">
                                {PHASE_STEPS.map((step, i) => {
                                    const state = resolveStepState(i, activeIdx, isSuccess, isFailed);
                                    const railFill = isSuccess
                                        ? 1
                                        : isFailed
                                            ? (i < activeIdx ? 1 : 0)
                                            : i < activeIdx
                                                ? 1
                                                : i === activeIdx
                                                    ? 0.5
                                                    : 0;
                                    return (
                                        <StepRow
                                            key={step}
                                            label={t(`prestart_${step}`, step)}
                                            state={state}
                                            isLast={i === PHASE_STEPS.length - 1}
                                            railFillPercent={railFill}
                                        />
                                    );
                                })}
                            </ol>
                        </div>

                        {isRunning ? (
                            <div className="flex items-center justify-center py-4">
                                <LivenessDots />
                            </div>
                        ) : (
                            <button
                                type="button"
                                className="w-full h-11 text-[14px] font-semibold transition-colors active:bg-[rgba(0,122,255,0.08)]"
                                style={{
                                    color: isFailed ? '#FF3B30' : 'var(--onebox-blue)',
                                    borderTop: '0.5px solid var(--onebox-separator)',
                                }}
                                onClick={onClose}
                            >
                                {t('close', 'Close')}
                            </button>
                        )}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

export default PrestartRepairModal;
