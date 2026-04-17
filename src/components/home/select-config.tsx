import { useEffect, useMemo, useState } from "react";
import { getStoreValue, setStoreValue } from "../../single/store";
import { SSI_STORE_KEY, Subscription } from "../../types/definition";
import { t } from "../../utils/helper";
import {
    AppleSelectMenu,
    AppleSelectOption,
    AppleSelectPlaceholder,
} from "./apple-select-menu";

type SubscriptionProps = {
    data: Subscription[] | undefined;
    isLoading: boolean;
    onUpdate: (identifier: string, isUpdate: boolean) => void;
};

const LOCAL_FILE_SENTINEL = 32503680000000;

function formatExpireHint(expire: number): string | null {
    if (expire === LOCAL_FILE_SENTINEL) {
        return t("local_file_no_expire");
    }
    try {
        return `${t("expired_at")} ${new Date(expire).toLocaleDateString("zh-CN")}`;
    } catch {
        return null;
    }
}

export default function SelectSub({ data, isLoading, onUpdate }: SubscriptionProps) {
    const [selected, setSelected] = useState<string>("");

    useEffect(() => {
        const syncDisplay = async () => {
            if (!data?.length) return;
            const savedId = await getStoreValue(SSI_STORE_KEY);
            const item = data.find((i) => i.identifier === savedId);
            if (item) {
                setSelected(item.identifier);
            } else {
                setSelected(data[0].identifier);
                await setStoreValue(SSI_STORE_KEY, data[0].identifier);
            }
        };
        syncDisplay();
    }, [data]);

    const options = useMemo<AppleSelectOption<string>[]>(() => {
        return (
            data?.map((item) => ({
                value: item.identifier,
                key: item.identifier,
                raw: item,
            })) ?? []
        );
    }, [data]);

    if (isLoading) {
        return (
            <AppleSelectPlaceholder tone="loading">
                <span className="inline-flex items-center gap-2">
                    <span className="inline-block size-3 rounded-full bg-blue-500/20 animate-pulse" />
                    {t("loading")}
                </span>
            </AppleSelectPlaceholder>
        );
    }

    if (!data?.length) {
        return (
            <AppleSelectPlaceholder>{t("no_subscription")}</AppleSelectPlaceholder>
        );
    }

    const selectedItem = data.find((i) => i.identifier === selected);

    const updateSubscription = async (identifier: string) => {
        const item = data.find((i) => i.identifier === identifier);
        if (!item) return;
        const prevId = await getStoreValue(SSI_STORE_KEY);
        setSelected(item.identifier);
        await setStoreValue(SSI_STORE_KEY, item.identifier);
        onUpdate(item.identifier, prevId !== item.identifier);
    };

    return (
        <AppleSelectMenu<string>
            value={selected}
            options={options}
            onChange={updateSubscription}
            menuMaxHeight={256}
            renderTrigger={() => (
                <span className="block truncate text-[14px] font-medium text-gray-900">
                    {selectedItem?.name ?? t("no_subscription")}
                </span>
            )}
            renderOption={({ option, isSelected }) => {
                const sub = option.raw as Subscription | undefined;
                if (!sub) return null;
                const hint = formatExpireHint(sub.expire_time);
                return (
                    <div className="flex flex-col min-w-0">
                        <span
                            className={`truncate text-[14px] ${
                                isSelected
                                    ? "text-blue-600 font-semibold"
                                    : "text-gray-900 font-medium"
                            }`}
                        >
                            {sub.name}
                        </span>
                        {hint && (
                            <span className="truncate text-[11px] text-gray-400 mt-0.5">
                                {hint}
                            </span>
                        )}
                    </div>
                );
            }}
        />
    );
}
