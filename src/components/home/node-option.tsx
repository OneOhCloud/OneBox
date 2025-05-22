import { fetch } from '@tauri-apps/plugin-http';
import useSWR from "swr";
import { t } from '../../utils/helper';

type NodeOptionProps = {
    nodeName: string;
};

export default function NodeOption({ nodeName }: NodeOptionProps) {
    const { data } = useSWR(`http://127.0.0.1:9191/proxies/${encodeURIComponent(nodeName)}`, async (url) => {
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
        refreshInterval: 5000,

    });
    const delay = data?.history?.[0]?.delay ?? '-';

    if (!nodeName) {
        return (
            <div className="select select-sm  select-ghost border-[0.8px] border-gray-200 ">
                {t('starting')}
            </div>
        );
    }

    if (nodeName === 'auto') {
        return (
            <div className="flex justify-between items-center w-full">
                <span className="truncate">{t("auto")}</span>
                <span className="ml-2 text-sm">{delay !== '-' ? `${delay}ms` : delay}</span>
            </div>
        );
    }

    return (
        <div className="flex justify-between items-center w-full">
            <span className="truncate">{nodeName}</span>
            <span className="ml-2 text-sm">{delay !== '-' ? `${delay}ms` : delay}</span>
        </div>
    );
}
