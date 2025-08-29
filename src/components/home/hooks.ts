import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm, message } from '@tauri-apps/plugin-dialog';
import { useContext, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { useIsRunning } from "../../hooks/useVersion";
import { NavContext } from "../../single/context";
import { getStoreValue, setStoreValue } from "../../single/store";
import { RULE_MODE_STORE_KEY } from "../../types/definition";
import { t, vpnServiceManager } from "../../utils/helper";

const url = "http://connectivitycheck.gstatic.com/generate_204";


export function useNetworkCheck(key: string, checkFn: () => Promise<number>) {
    const [shouldRefresh, setShouldRefresh] = useState(true);
    const [confirmShown, setConfirmShown] = useState(false);

    async function handleNetworkCheck() {
        if (!shouldRefresh) {
            return false
        }

        try {
            const status = await checkFn();
            if (status == 1 && !confirmShown) {
                setShouldRefresh(false);
                setConfirmShown(true);
                const answer = await confirm(t("network_need_login"), {
                    title: t("network_need_login_title"),
                    kind: 'warning',
                });

                if (answer) {
                    setConfirmShown(false);
                    await invoke('open_browser', {
                        app: getCurrentWindow(),
                        url: url
                    });
                }

                setTimeout(() => {
                    setShouldRefresh(true);
                    setConfirmShown(false);
                }, 15000);
            }

            //  状态为 0 代表网络正常。
            return status == 0;
        } catch (error) {
            console.error(`Network check failed: ${error}`);
            return false;
        }

    }

    return useSWR(key, handleNetworkCheck, {
        refreshInterval: 1000
    });
}

export function useGstaticNetworkCheck() {
    return useNetworkCheck(
        `apple-network-check`, async () => {
            return await invoke<number>('ping_captive')
        }

    );
}

export function useGoogleNetworkCheck() {

    return useSWR(
        `swr-google-check`,
        async () => {
            return invoke<boolean>('ping_google');
        },
        { refreshInterval: 1000 }
    );
}




// 类型定义
export type ProxyMode = 'rules' | 'global';
type OperationStatus = 'starting' | 'stopping' | 'idle';

/**
 * 自定义Hook: 管理代理模式状态
 */
export const useProxyMode = () => {
    const [selectedMode, setSelectedMode] = useState<ProxyMode>('rules');

    const initializeMode = async () => {
        try {
            const storedMode = await getStoreValue(RULE_MODE_STORE_KEY) as ProxyMode;
            if (storedMode) {
                setSelectedMode(storedMode);
            } else {
                await setStoreValue(RULE_MODE_STORE_KEY, 'rules');
                setSelectedMode('rules');
            }
        } catch (error) {
            console.error('获取规则模式发生错误:', error);
            await setStoreValue(RULE_MODE_STORE_KEY, 'rules');
            setSelectedMode('rules');
        }
    };

    const changeMode = async (mode: ProxyMode) => {
        await setStoreValue(RULE_MODE_STORE_KEY, mode);
        setSelectedMode(mode);
    };

    return {
        selectedMode,
        initializeMode,
        changeMode
    };
};

/**
 * 自定义Hook: 管理VPN服务操作状态
 */
export const useVPNOperations = () => {
    const [isOperating, setIsOperating] = useState(false);
    const [operationStatus, setOperationStatus] = useState<OperationStatus>('idle');
    const [privilegedDialog, setPrivilegedDialog] = useState(false);

    const { isRunning, isLoading: serviceLoading, mutate } = useIsRunning();
    const { setActiveScreen } = useContext(NavContext);

    // 合并所有loading状态
    const isLoading = isOperating || serviceLoading;

    const stopService = async () => {
        setOperationStatus('stopping');
        await vpnServiceManager.stop();
        mutate();
        setOperationStatus('idle');
    };

    const startService = async (isEmpty: boolean) => {
        if (isEmpty) {
            setActiveScreen('configuration');
            return message(t('please_add_subscription'), { title: t('tips'), kind: 'error' });
        }

        setIsOperating(true);
        setOperationStatus('starting');

        vpnServiceManager.syncConfig({
            onSuccess: async () => {
                try {
                    await vpnServiceManager.start();
                    mutate();
                } catch (error: any) {
                    // 检查是否是权限问题
                    if (error?.message?.includes('REQUIRE_PRIVILEGE')) {
                        console.log('需要权限验证，显示权限对话框');
                        setPrivilegedDialog(true);
                        setIsOperating(false);
                        setOperationStatus('idle');
                        return;
                    }
                    console.error('启动服务失败:', error);
                    await message(t('connect_failed'), { title: t('error'), kind: 'error' });
                } finally {
                    setIsOperating(false);
                    setOperationStatus('idle');
                }
            },
            onError: async (error) => {
                console.error('同步配置失败:', error);
                await stopService();
                setIsOperating(false);
                setOperationStatus('idle');
            },
            onRequirePrivileged: () => {
                setPrivilegedDialog(true);
                setIsOperating(false);
                setOperationStatus('idle');
            }
        });
    };

    const restartService = async (isEmpty: boolean) => {
        if (isEmpty) {
            setActiveScreen('configuration');
            return message(t('please_add_subscription'), { title: t('tips'), kind: 'error' });
        }

        setIsOperating(true);
        setOperationStatus('starting');

        try {
            vpnServiceManager.syncConfig({});
            vpnServiceManager.reload(1000);
        } catch (error) {
            console.error('重启服务失败:', error);
            await message(t('reconnect_failed'), { title: t('error'), kind: 'error' });
        } finally {
            setIsOperating(false);
            setOperationStatus('idle');
        }
    };

    const toggleService = async (isEmpty: boolean) => {
        if (isEmpty) {
            setActiveScreen('configuration');
            return message(t('please_add_subscription'), { title: t('tips'), kind: 'error' });
        }

        try {
            if (isRunning) {
                await stopService();
            } else {
                setIsOperating(true);
                setOperationStatus('starting');
                try {
                    await startService(isEmpty);
                } finally {
                    setTimeout(() => {
                        setIsOperating(false);
                        setOperationStatus('idle');
                    }, 2000)
                }
            }
        } catch (error) {
            console.error('连接失败:', error);
            await message(`${t('connect_failed')}: ${error}`, { title: t('error'), kind: 'error' });
            setIsOperating(false);
            setOperationStatus('idle');
        }
    };

    return {
        isOperating,
        operationStatus,
        privilegedDialog,
        isLoading,
        isRunning,
        setPrivilegedDialog,
        startService,
        restartService,
        toggleService,
        mutate
    };
};

/**
 * 自定义Hook: 管理模式切换指示器位置
 */
export const useModeIndicator = (selectedMode: ProxyMode) => {
    const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });
    const modeButtonsRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const container = modeButtonsRef.current;
        const activeButton = container?.querySelector(`button[data-mode="${selectedMode}"]`);

        if (container && activeButton) {
            const containerRect = container.getBoundingClientRect();
            const buttonRect = activeButton.getBoundingClientRect();

            setIndicatorStyle({
                left: buttonRect.left - containerRect.left,
                width: buttonRect.width,
            });
        }
    }, [selectedMode]);

    return {
        indicatorStyle,
        modeButtonsRef
    };
};