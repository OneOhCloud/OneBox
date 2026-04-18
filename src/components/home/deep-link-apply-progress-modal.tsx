import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef } from 'react';
import { CheckCircleFill, XCircleFill } from 'react-bootstrap-icons';
import { t } from '../../utils/helper';

export type DeepLinkApplyPhase = 'init' | 'import' | 'start' | 'done' | 'error';

type StepKey = 'init' | 'import' | 'start';

export interface DeepLinkApplyProgressModalProps {
    visible: boolean;
    phase: DeepLinkApplyPhase;
    errorMessage?: string;
    onClose?: () => void;
    stepLabels?: Partial<Record<StepKey | 'done', string>>;
    // Which steps to render. Default = full apply=1 3-step flow.
    // Manual-add passes `['import']` so only one step (no rail) renders.
    steps?: readonly StepKey[];
    // Title overrides. `done` still uses stepLabels.done.
    titleLabels?: { running?: string; error?: string };
}

type StepState = 'idle' | 'active' | 'done' | 'error';

const DEFAULT_STEPS: readonly StepKey[] = ['init', 'import', 'start'];

// Vertical distance between step-circle centres. With h-[38px] rows, the
// rail segment between two circles is 38 - circle_size = 38 - 20 = 18.
const STEP_ROW_HEIGHT_PX = 38;
const CIRCLE_SIZE_PX = 20;
const RAIL_SEGMENT_PX = STEP_ROW_HEIGHT_PX - CIRCLE_SIZE_PX;

function phaseToIndex(phase: DeepLinkApplyPhase, stepKeys: readonly StepKey[]): number {
    if (phase === 'done') return stepKeys.length;
    const idx = stepKeys.indexOf(phase as StepKey);
    return idx; // -1 for 'error' is fine — lastRunningIdxRef preserves the last valid step
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

/**
 * Step-status glyph. Four variants:
 *   done   → filled systemBlue checkmark circle
 *   error  → filled systemRed x-mark circle
 *   active → filled systemBlue disc with white inner dot; opacity pulses
 *            0.7→1→0.7 at 1.8s (calm liveness, no rotation)
 *   idle   → hollow circle with inset hairline ring
 */
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

export function DeepLinkApplyProgressModal({
    visible,
    phase,
    errorMessage,
    onClose,
    stepLabels,
    steps,
    titleLabels,
}: DeepLinkApplyProgressModalProps) {
    const stepKeys = steps ?? DEFAULT_STEPS;

    // Remember the last running step so 'error' paints the correct step red.
    const lastRunningIdxRef = useRef(0);
    useEffect(() => {
        const idx = phaseToIndex(phase, stepKeys);
        if (idx >= 0 && idx < stepKeys.length) lastRunningIdxRef.current = idx;
    }, [phase, stepKeys]);

    const activeIdx =
        phase === 'error' ? lastRunningIdxRef.current : phaseToIndex(phase, stepKeys);
    const isError = phase === 'error';
    const isDone = phase === 'done';
    const isRunning = !isError && !isDone;

    const labelFor = (k: StepKey | 'done') =>
        stepLabels?.[k] ?? t(`dl_phase_${k}`);

    const titleText = isError
        ? (titleLabels?.error ?? t('connect_failed', 'Connection failed'))
        : isDone
            ? labelFor('done')
            : (titleLabels?.running ?? t('dl_phase_title', 'Applying configuration'));

    return (
        <AnimatePresence>
            {visible && (
                <motion.div
                    key="dl-apply-modal"
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
                        className="relative w-full max-w-72.5 bg-white rounded-[14px] overflow-hidden"
                        style={{
                            boxShadow:
                                '0 22px 48px -12px rgba(15, 23, 42, 0.3), 0 4px 14px rgba(15, 23, 42, 0.08)',
                        }}
                        initial={{ scale: 0.92, y: 8 }}
                        animate={{ scale: 1, y: 0 }}
                        exit={{ scale: 0.94, y: 4 }}
                        transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
                    >
                        <div className="pt-5 px-5 pb-4">
                            {/* State chip — only when terminal */}
                            {(isError || isDone) && (
                                <div
                                    className="size-11 rounded-xl flex items-center justify-center mx-auto mb-3"
                                    style={{
                                        background: isError
                                            ? 'rgba(255, 59, 48, 0.1)'
                                            : 'rgba(52, 199, 89, 0.12)',
                                    }}
                                >
                                    {isError ? (
                                        <XCircleFill
                                            size={22}
                                            style={{ color: '#FF3B30' }}
                                        />
                                    ) : (
                                        <CheckCircleFill
                                            size={22}
                                            style={{ color: '#34C759' }}
                                        />
                                    )}
                                </div>
                            )}

                            <h3
                                className="text-[16px] font-semibold text-center tracking-[-0.01em] mb-4"
                                style={{ color: 'var(--onebox-label)' }}
                            >
                                {titleText}
                            </h3>

                            <ol className="relative m-0 p-0 pl-1">
                                {stepKeys.map((key, i) => {
                                    const state = resolveStepState(
                                        i,
                                        activeIdx,
                                        isDone,
                                        isError,
                                    );
                                    const railFill = isDone
                                        ? 1
                                        : isError
                                            ? (i < activeIdx ? 1 : 0)
                                            : i < activeIdx
                                                ? 1
                                                : i === activeIdx
                                                    ? 0.5
                                                    : 0;
                                    return (
                                        <StepRow
                                            key={key}
                                            label={labelFor(key)}
                                            state={state}
                                            isLast={i === stepKeys.length - 1}
                                            railFillPercent={railFill}
                                        />
                                    );
                                })}
                            </ol>

                            <AnimatePresence>
                                {isError && errorMessage && (
                                    <motion.div
                                        key="err"
                                        className="mt-3 rounded-xl px-3 py-2 text-[12px] leading-snug"
                                        style={{
                                            background: 'rgba(255, 59, 48, 0.08)',
                                            color: '#FF3B30',
                                        }}
                                        initial={{ opacity: 0, y: -4 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0 }}
                                    >
                                        {errorMessage}
                                    </motion.div>
                                )}
                            </AnimatePresence>
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
                                    color: 'var(--onebox-blue)',
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

export default DeepLinkApplyProgressModal;
