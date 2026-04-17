import clsx from "clsx";
import { ReactNode } from "react";

export interface RadioOption<T extends string> {
    key: T;
    label: string;
    sublabel?: ReactNode;
    disabled?: boolean;
}

interface RadioOptionListProps<T extends string> {
    value: T;
    onChange: (v: T) => void;
    options: RadioOption<T>[];
}

/**
 * iOS-style radio list inside a grouped card. Tap anywhere on a row to
 * select it (the `<label>` wraps the hidden input so the whole row is
 * the hit target). Custom radio glyph: systemBlue fill with a white
 * centre dot when selected, hollow ring when not.
 */
export function RadioOptionList<T extends string>({
    value,
    onChange,
    options,
}: RadioOptionListProps<T>) {
    return (
        <div className="onebox-grouped-card">
            {options.map((opt) => {
                const checked = value === opt.key;
                return (
                    <label
                        key={opt.key}
                        className={clsx(
                            "flex items-center gap-3 px-4 py-3 transition-colors",
                            opt.disabled
                                ? "opacity-50 cursor-not-allowed"
                                : "cursor-pointer active:bg-[rgba(60,60,67,0.04)]",
                        )}
                    >
                        <div className="flex-1 min-w-0">
                            <div
                                className="text-[14px] tracking-[-0.005em]"
                                style={{ color: "var(--onebox-label)" }}
                            >
                                {opt.label}
                            </div>
                            {opt.sublabel && (
                                <div
                                    className="text-[12px] mt-0.5"
                                    style={{
                                        color: "var(--onebox-label-secondary)",
                                    }}
                                >
                                    {opt.sublabel}
                                </div>
                            )}
                        </div>
                        <input
                            type="radio"
                            checked={checked}
                            onChange={() =>
                                !opt.disabled && onChange(opt.key)
                            }
                            disabled={opt.disabled}
                            className="
                                shrink-0 appearance-none
                                size-[18px] rounded-full
                                border-[1.5px] border-[rgba(60,60,67,0.28)]
                                checked:border-[var(--onebox-blue)]
                                checked:bg-[var(--onebox-blue)]
                                relative
                                before:content-[''] before:absolute
                                before:w-[6px] before:h-[6px]
                                before:bg-white before:rounded-full
                                before:top-1/2 before:left-1/2
                                before:-translate-x-1/2 before:-translate-y-1/2
                                before:opacity-0 checked:before:opacity-100
                                transition-colors
                                disabled:opacity-40
                            "
                        />
                    </label>
                );
            })}
        </div>
    );
}
