import useSWR from "swr";
import { fetch } from '@tauri-apps/plugin-http';

type NodeOptionProps = {
    disabled: boolean;
    nodeName: string;
};

export default function NodeOption({ nodeName, disabled }: NodeOptionProps) {
    const { data } = useSWR(`http://localhost:9191/proxies/${encodeURIComponent(nodeName)}`, async (url) => {
        if (disabled) {
            return null;
        }

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
        });

        let res = await response.json()
        return res
    }, {
        refreshInterval: 5000, // 每5秒刷新一次
        revalidateOnFocus: false, // 失去焦点时不重新验证
        revalidateOnReconnect: false, // 重新连接时不重新验证

    });
    const delay = data?.history?.[0]?.delay ?? '-';

    return (
        <div className="flex justify-between items-center w-full">
            <span className="truncate">{nodeName || '未选择'}</span>
            <span className="ml-2 text-sm">{delay !== '-' ? `${delay}ms` : delay}</span>
        </div>
    );
}
