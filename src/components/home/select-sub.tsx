import { useState, useEffect } from "react";
import { useSubscriptions } from "../../hooks/useDB";
import { Subscription } from "../../types/definition";


type SubscriptionProps = {
    onUpdate: (item: Subscription) => void;

}

export default function SelectSub(props: SubscriptionProps) {
    const { data, isLoading } = useSubscriptions()
    const [selectedSubscription, setSelectedSubscription] = useState<string>('');

    useEffect(() => {
        if (data && data.length > 0) {
            handleBaseSubscriptionChange(data[0]);
        }

    }, [data]);

    const handleBaseSubscriptionChange = (item: Subscription) => {
        setSelectedSubscription(item.name);
        props.onUpdate(item);

    }

    const handleSubscriptionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        setSelectedSubscription(e.target.value);

        const selectedItem = data?.find(item => item.name === e.target.value);
        if (selectedItem) {
            handleBaseSubscriptionChange(selectedItem);
        }
    }

    return (
        <div className="relative">
            {isLoading ? (
                <div className="select select-sm select-neutral">
                    <span className="loading loading-spinner loading-xs mr-2"></span>
                    正在加载...
                </div>
            ) : data && data.length > 0 ? (
                <select
                    value={selectedSubscription}
                    onChange={handleSubscriptionChange}
                    className="select select-sm select-neutral"
                >
                    {data.map((item) => (
                        <option key={item.identifier} className="py-1">{item.name}</option>
                    ))}
                </select>
            ) : (
                <div className="select select-sm select-neutral">
                    暂无订阅配置
                </div>
            )}
        </div>
    )
}