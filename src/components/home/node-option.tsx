import { fetch } from '@tauri-apps/plugin-http';
import clsx from 'clsx';
import { useEffect, useState } from 'react';
import useSWR from "swr";
import { getClashApiSecret } from '../../single/store';
import { t } from '../../utils/helper';

// 常量定义
const DELAY_THRESHOLDS = {
    GOOD: 200,
    NORMAL: 300,
    WARN: 600
} as const;

const BASE_URL = 'http://127.0.0.1:9191';

// 类型定义
type DelayStatus = '-' | number;

interface ProxyHistory {
    delay: number;
}

interface ProxyResponse {
    history: ProxyHistory[];
}

// 延迟状态判断
const getDelayStatus = (delay: DelayStatus) => {
    if (delay === '-') return '';
    if (delay <= DELAY_THRESHOLDS.GOOD) return 'green';
    if (delay <= DELAY_THRESHOLDS.NORMAL) return 'yellow';
    if (delay <= DELAY_THRESHOLDS.WARN) return 'orange';
    return 'red';
};

// 通用样式
const commonStyles = {
    delayText: 'ml-2 text-sm font-medium transition-all duration-300 ease',
    delayDot: 'inline-block w-2 h-2 rounded-full transition-all duration-300 ease'
};

type NodeOptionProps = {
    nodeName: string;
    showDelay: boolean;

};

export default function NodeOption({ nodeName, showDelay }: NodeOptionProps) {
    const [delayText, setDelayText] = useState<string>('-');
    const { data } = useSWR<ProxyResponse>(
        nodeName ? `${BASE_URL}/proxies/${encodeURIComponent(nodeName)}` : null,
        async (url) => {
            const response = await fetch(url, {
                method: 'GET',
                // @ts-ignore
                timeout: 3,
                headers: {
                    "Authorization": `Bearer ${await getClashApiSecret()}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
            });
            return response.json();
        },
        { refreshInterval: 1000 }
    );

    const delay: DelayStatus = data?.history?.[0]?.delay ?? '-';
    const delayColor = getDelayStatus(delay);

    const DelayIndicator = () => {
        if (showDelay) {
            return (
                <div className={clsx(
                    commonStyles.delayText,
                    `text-${delayColor}-500`,
                    'flex items-center gap-1.5'
                )}>
                    <span className={clsx(
                        commonStyles.delayDot,
                        `bg-${delayColor}-500`
                    )} />
                    {delay === '-' ? delayText : `${delay}ms`}
                </div>
            );
        } else {
            return <span className="loading loading-dots loading-xs"></span>
        }
    };


    useEffect(() => {
        setTimeout(() => {
            setDelayText(t("timeout"))
        }, 5000);
    }, []);

    if (!nodeName) {
        return (
            <div className="select select-sm select-ghost border-[0.8px] border-gray-200">
                {t('starting')}
            </div>
        );
    }

    return (
        <div className="flex justify-between items-center w-full">
            <span className="truncate font-medium">
                {nodeName === 'auto' ? t("auto") : nodeName}
            </span>
            <DelayIndicator />
        </div>
    );
}