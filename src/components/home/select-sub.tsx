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
            setSelectedSubscription(data[0].name);
            props.onUpdate(data[0]);

        }
    }, [data]);

    const handleSubscriptionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        setSelectedSubscription(e.target.value);

        const selectedItem = data?.find(item => item.name === e.target.value);
        if (selectedItem) {
            props.onUpdate(selectedItem);
        }
    }

    return (
        <div className="relative">
            {isLoading ? (
                <div className="select select-sm w-full flex items-center justify-center text-gray-500 bg-gray-100 border border-gray-300 rounded-md">
                    <span className="loading loading-spinner loading-xs mr-2"></span>
                    正在加载...
                </div>
            ) : data && data.length > 0 ? (
                <select
                    value={selectedSubscription}
                    onChange={handleSubscriptionChange}
                    className="select select-sm w-full text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none hover:border-blue-300 transition-colors"
                >
                    {data.map((item) => (
                        <option key={item.identifier} className="py-1">{item.name}</option>
                    ))}
                </select>
            ) : (
                <div className="select select-sm w-full flex items-center justify-center text-gray-500 bg-gray-100 border border-gray-300 rounded-md">
                    暂无订阅配置
                </div>
            )}
        </div>
    )
}