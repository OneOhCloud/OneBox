import { useEffect, useState } from "react";
import { getStoreValue, setStoreValue } from "../../single/store";
import { SSI_STORE_KEY, Subscription } from "../../types/definition";
import { t } from "../../utils/helper";

type SubscriptionProps = {
    data: Subscription[] | undefined;
    isLoading: boolean;
    onUpdate: (identifier: string, isUpdate: boolean) => void;
}

export default function SelectSub({ data, isLoading, onUpdate }: SubscriptionProps) {
    const [selected, setSelected] = useState<string>('');

    useEffect(() => {
        const syncDisplay = async () => {
            if (!data?.length) return;
            const savedId = await getStoreValue(SSI_STORE_KEY);
            const item = data.find(i => i.identifier === savedId);
            if (item) {
                setSelected(item.identifier);
            } else {
                // Saved subscription was deleted or no prior selection — fall back to first item
                setSelected(data[0].identifier);
                await setStoreValue(SSI_STORE_KEY, data[0].identifier);
            }
        };
        syncDisplay();
    }, [data]);

    const updateSubscription = async (item: Subscription) => {
        const prevId = await getStoreValue(SSI_STORE_KEY);
        setSelected(item.identifier);
        await setStoreValue(SSI_STORE_KEY, item.identifier);
        onUpdate(item.identifier, prevId !== item.identifier);
    }

    if (isLoading) {
        return <div className="select select-sm  select-ghost border-[0.8px] border-gray-200 ">
            <span className="loading loading-spinner loading-xs mr-2"></span>
            {
                /* 正在加载... */
                t("loading")
            }
        </div>;
    }

    if (!data?.length) {
        return <div className="select select-sm  select-ghost border-[0.8px] border-gray-200 ">
            {
                /* 暂无订阅配置 */
                t("no_subscription")
            }
        </div>;
    }

    return (
        <select
            value={selected}
            onChange={e => {
                const item = data.find(item => item.identifier === e.target.value);
                if (item) updateSubscription(item);
            }}
            className="select select-sm  select-ghost border-[0.8px] border-gray-200 "
        >
            {data.map(item => (
                <option key={item.identifier} value={item.identifier} className="py-1">{item.name}</option>
            ))}
        </select>
    );
}