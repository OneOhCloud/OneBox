import { AnimatePresence, motion } from "framer-motion";
import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronExpand } from "react-bootstrap-icons";

export type AppleSelectOption<T> = {
    value: T;
    key: string;
    disabled?: boolean;
    raw?: unknown;
};

type TriggerRenderArgs<T> = {
    selected: AppleSelectOption<T> | undefined;
    isOpen: boolean;
};

type OptionRenderArgs<T> = {
    option: AppleSelectOption<T>;
    isSelected: boolean;
};

type AppleSelectMenuProps<T> = {
    value: T | null | undefined;
    options: AppleSelectOption<T>[];
    onChange: (value: T) => void;
    renderTrigger: (args: TriggerRenderArgs<T>) => ReactNode;
    renderOption: (args: OptionRenderArgs<T>) => ReactNode;
    disabled?: boolean;
    emptyLabel?: ReactNode;
    menuMaxHeight?: number;
    keyEquals?: (a: T, b: T) => boolean;
    className?: string;
};

// Apple-style custom popup menu.
// Soft fill, no borders, backdrop blur on the popover surface, spring-like
// entrance sized to the trigger width. Auto-flips above the trigger when
// the viewport lacks room below.
export function AppleSelectMenu<T>(props: AppleSelectMenuProps<T>) {
    const {
        value,
        options,
        onChange,
        renderTrigger,
        renderOption,
        disabled,
        emptyLabel,
        menuMaxHeight = 240,
        keyEquals,
        className,
    } = props;

    const [isOpen, setIsOpen] = useState(false);
    const [placement, setPlacement] = useState<"up" | "down">("down");
    const wrapperRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);

    const selected = options.find((opt) =>
        keyEquals
            ? value != null && keyEquals(opt.value, value)
            : opt.value === value,
    );

    useEffect(() => {
        if (!isOpen) return;
        const onDocClick = (event: MouseEvent) => {
            if (!wrapperRef.current?.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        const onEsc = (event: KeyboardEvent) => {
            if (event.key === "Escape") setIsOpen(false);
        };
        document.addEventListener("mousedown", onDocClick);
        document.addEventListener("keydown", onEsc);
        return () => {
            document.removeEventListener("mousedown", onDocClick);
            document.removeEventListener("keydown", onEsc);
        };
    }, [isOpen]);

    useLayoutEffect(() => {
        if (!isOpen) return;
        const rect = triggerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceAbove = rect.top;
        const needed = menuMaxHeight + 16;
        setPlacement(
            spaceBelow < needed && spaceAbove > spaceBelow ? "up" : "down",
        );
    }, [isOpen, menuMaxHeight]);

    const toggle = () => {
        if (disabled) return;
        setIsOpen((open) => !open);
    };

    return (
        <div ref={wrapperRef} className={`relative w-full ${className ?? ""}`}>
            <button
                ref={triggerRef}
                type="button"
                disabled={disabled}
                onClick={toggle}
                className={`
                    group w-full text-left rounded-2xl
                    bg-white
                    px-3.5 py-2.5
                    shadow-[0_1px_2px_rgba(15,23,42,0.04),0_1px_3px_rgba(15,23,42,0.06)]
                    transition-all duration-150 ease-out
                    hover:shadow-[0_2px_6px_rgba(15,23,42,0.06),0_2px_12px_rgba(15,23,42,0.06)]
                    active:scale-[0.995]
                    focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30
                    disabled:opacity-60 disabled:cursor-not-allowed
                    disabled:hover:shadow-[0_1px_2px_rgba(15,23,42,0.04),0_1px_3px_rgba(15,23,42,0.06)]
                    disabled:active:scale-100
                    ${isOpen ? "shadow-[0_4px_18px_rgba(15,23,42,0.08),0_2px_6px_rgba(15,23,42,0.06)]" : ""}
                `}
            >
                <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                        {renderTrigger({ selected, isOpen })}
                    </div>
                    <ChevronExpand
                        className={`
                            size-3 shrink-0 text-gray-400
                            transition-transform duration-200
                            ${isOpen ? "text-blue-500" : ""}
                        `}
                    />
                </div>
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        key="apple-select-menu"
                        initial={{
                            opacity: 0,
                            scale: 0.96,
                            y: placement === "up" ? 6 : -6,
                        }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{
                            opacity: 0,
                            scale: 0.97,
                            y: placement === "up" ? 4 : -4,
                        }}
                        transition={{
                            duration: 0.16,
                            ease: [0.32, 0.72, 0, 1],
                        }}
                        style={{
                            transformOrigin:
                                placement === "up" ? "50% 100%" : "50% 0%",
                        }}
                        className={`
                            absolute left-0 right-0 z-50
                            ${placement === "up" ? "bottom-full mb-2" : "top-full mt-2"}
                        `}
                    >
                        <div
                            className="
                                overflow-hidden rounded-2xl
                                bg-white/85 backdrop-blur-2xl backdrop-saturate-150
                                shadow-[0_16px_48px_rgba(15,23,42,0.16),0_4px_12px_rgba(15,23,42,0.08)]
                            "
                        >
                            <div
                                className="overflow-y-auto p-1.5"
                                style={{ maxHeight: menuMaxHeight }}
                            >
                                {options.length === 0 ? (
                                    <div className="px-3 py-3 text-sm text-gray-400 text-center">
                                        {emptyLabel ?? "—"}
                                    </div>
                                ) : (
                                    options.map((option, index) => {
                                        const isSelected = option === selected;
                                        return (
                                            <motion.button
                                                key={option.key}
                                                type="button"
                                                disabled={option.disabled}
                                                initial={{
                                                    opacity: 0,
                                                    y: placement === "up" ? 4 : -4,
                                                }}
                                                animate={{ opacity: 1, y: 0 }}
                                                transition={{
                                                    duration: 0.18,
                                                    delay: Math.min(index, 8) * 0.012,
                                                    ease: [0.32, 0.72, 0, 1],
                                                }}
                                                onClick={() => {
                                                    if (option.disabled) return;
                                                    onChange(option.value);
                                                    setIsOpen(false);
                                                }}
                                                className={`
                                                    w-full text-left
                                                    px-3 py-2 rounded-xl
                                                    flex items-center gap-2
                                                    transition-colors duration-100
                                                    focus:outline-none
                                                    ${
                                                        isSelected
                                                            ? "bg-blue-500/10"
                                                            : "hover:bg-gray-900/5 active:bg-gray-900/10"
                                                    }
                                                    ${option.disabled ? "opacity-40 cursor-not-allowed" : ""}
                                                `}
                                            >
                                                <div className="flex-1 min-w-0">
                                                    {renderOption({
                                                        option,
                                                        isSelected,
                                                    })}
                                                </div>
                                                <Check
                                                    className={`
                                                        size-4 shrink-0 text-blue-500
                                                        transition-opacity duration-150
                                                        ${isSelected ? "opacity-100" : "opacity-0"}
                                                    `}
                                                />
                                            </motion.button>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

// Rendered when a selector has nothing actionable (loading, empty, or
// "not running"). Keeps vertical rhythm identical to the active trigger
// so the layout doesn't jump between states.
export function AppleSelectPlaceholder({
    children,
    tone = "muted",
}: {
    children: ReactNode;
    tone?: "muted" | "loading";
}) {
    return (
        <div
            className={`
                w-full rounded-2xl bg-white/60 px-3.5 py-2.5
                shadow-[0_1px_2px_rgba(15,23,42,0.03)]
                flex items-center gap-2
                ${tone === "loading" ? "" : "opacity-70"}
            `}
        >
            <div className="flex-1 min-w-0 text-sm text-gray-400">
                {children}
            </div>
        </div>
    );
}
