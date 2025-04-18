import { useEffect, useState } from "react";
import { getStoreValue, setStoreValue } from "../../single/store";
import { Subscription } from "../../types/definition";

type SubscriptionProps = {
    data: Subscription[] | undefined;
    isLoading: boolean;
    onUpdate: (identifier: string, isUpdate: boolean) => void;
}

export default function SelectSub({ data, isLoading, onUpdate }: SubscriptionProps) {
    const [selected, setSelected] = useState<string>('');

    useEffect(() => {
        const init = async () => {
            if (!data?.length) return;
            const savedId = await getStoreValue('selected_subscription_identifier');
            const item = data.find(item => item.identifier === savedId) || data[0];
            await updateSubscription(item);
        };
        init();
    }, [data]);

    const updateSubscription = async (item: Subscription) => {
        const prevId = await getStoreValue('selected_subscription_identifier');
        setSelected(item.name);
        await setStoreValue('selected_subscription_identifier', item.identifier);
        onUpdate(item.identifier, prevId !== item.identifier);
    }

    if (isLoading) {
        return <div className="select select-sm select-neutral">
            <span className="loading loading-spinner loading-xs mr-2"></span>
            正在加载...
        </div>;
    }

    if (!data?.length) {
        return <div className="select select-sm select-neutral">暂无订阅配置</div>;
    }

    return (
        <select
            value={selected}
            onChange={e => {
                const item = data.find(item => item.name === e.target.value);
                if (item) updateSubscription(item);
            }}
            className="select select-sm select-neutral"
        >
            {data.map(item => (
                <option key={item.identifier} className="py-1">{item.name}</option>
            ))}
        </select>
    );
}