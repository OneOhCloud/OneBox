import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm, message } from '@tauri-apps/plugin-dialog';
import { useContext, useEffect, useRef, useState } from "react";
import useSWR, { mutate as swrMutate } from "swr";
import { insertSubscription } from "../../action/db";
import { clearEngineError, useEngineState } from "../../hooks/useEngineState";
import { NavContext } from "../../single/context";
import { getStoreValue, setStoreValue } from "../../single/store";
import { GET_SUBSCRIPTIONS_LIST_SWR_KEY, RULE_MODE_STORE_KEY, SSI_STORE_KEY } from "../../types/definition";
import { t, vpnServiceManager } from "../../utils/helper";
import type { DeepLinkApplyPhase } from "./deep-link-apply-progress-modal";



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
                    await vpnServiceManager.stop();
                    let url = await invoke("get_captive_redirect_url");
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
        refreshInterval: 1000 * 5, // check every 5 seconds
    });
}

export function useGstaticNetworkCheck() {
    return useNetworkCheck(
        `apple-network-check`, async () => {
            return await invoke<number>('check_captive_portal_status')
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
export type OperationStatus = 'starting' | 'stopping' | 'idle';

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
 *
 * Plan B 后:权威状态来自 Rust 的 `engine-state` 事件(经由 `EngineStateContext`),
 * 本 hook 只剩下 UI 操作入口与派生的 isLoading/isRunning/operationStatus,
 * 供现有消费者保持兼容。不再维护独立的 isOperating / setTimeout 兜底。
 */
export const useVPNOperations = () => {
    const engineState = useEngineState();
    const { setActiveScreen, deepLinkApplyUrl, setDeepLinkApplyUrl } = useContext(NavContext);

    // Deep-link apply=1 progress surface. `null` = modal hidden.
    const [applyPhase, setApplyPhase] = useState<DeepLinkApplyPhase | null>(null);
    const [applyErrorMessage, setApplyErrorMessage] = useState<string>('');
    // Epoch at the moment we enter the 'start' phase. Only engine transitions
    // past this epoch can close the modal — avoids a stale `running` snapshot
    // (e.g. the previous subscription) flipping us to 'done' prematurely.
    const applyEpochRef = useRef<number>(-1);

    // 从权威状态派生出兼容变量
    const isRunning = engineState.kind === 'running';
    const isLoading = engineState.kind === 'starting' || engineState.kind === 'stopping';
    const operationStatus: OperationStatus =
        engineState.kind === 'starting'
            ? 'starting'
            : engineState.kind === 'stopping'
                ? 'stopping'
                : 'idle';

    // 失败状态:弹窗提示并回到 Idle,避免前端永久卡在 failed。
    // Suppressed while the apply modal is live — the modal surfaces the error
    // instead, to avoid a double prompt.
    useEffect(() => {
        if (engineState.kind !== 'failed') return;
        if (applyPhase !== null) return;
        const reason = engineState.reason;
        (async () => {
            await message(`${t('connect_failed')}: ${reason}`, { title: t('error'), kind: 'error' });
            await clearEngineError();
        })();
    }, [engineState.kind === 'failed' ? engineState.epoch : null, applyPhase]);

    // Drive apply modal to 'done' / 'error' based on engine transitions that
    // happen after we issued the start command.
    useEffect(() => {
        if (applyPhase !== 'start') return;
        if (engineState.epoch <= applyEpochRef.current) return;
        if (engineState.kind === 'running') {
            setApplyPhase('done');
        } else if (engineState.kind === 'failed') {
            setApplyErrorMessage(engineState.reason || t('connect_failed'));
            setApplyPhase('error');
            clearEngineError().catch(() => { });
        }
    }, [applyPhase, engineState.kind, engineState.epoch]);

    // Backstop timeout: if the engine never transitions (silent IPC failure or
    // indefinite connect attempt), flip to error after 45s so the modal never
    // wedges.
    useEffect(() => {
        if (applyPhase !== 'start') return;
        const timer = setTimeout(() => {
            setApplyErrorMessage(t('connect_failed'));
            setApplyPhase('error');
        }, 45000);
        return () => clearTimeout(timer);
    }, [applyPhase]);

    const closeApplyModal = () => {
        setApplyPhase(null);
        setApplyErrorMessage('');
    };

    const stopService = async () => {
        try {
            await vpnServiceManager.stop();
        } catch (error) {
            console.error('停止服务失败:', error);
        }
    };

    const performSyncAndStart = (onSyncError: (error: any) => Promise<void>) => {
        vpnServiceManager.syncConfig({
            onSuccess: async () => {
                try {
                    await vpnServiceManager.start();
                } catch (error: any) {
                    console.error('启动服务失败:', error);
                }
            },
            onError: async (error) => {
                await onSyncError(error);
            },
        });
    };

    // apply=1 deep link: import subscription, switch to it, then start.
    // Phase state drives the progress modal so users get clear feedback during
    // the 10-20s cold-start window instead of staring at a frozen UI.
    useEffect(() => {
        if (!deepLinkApplyUrl) return;
        const url = deepLinkApplyUrl;
        setDeepLinkApplyUrl('');

        setApplyErrorMessage('');
        setApplyPhase('init');

        (async () => {
            // Brief 'init' dwell so the modal can render its entrance animation
            // before the first real work starts.
            await new Promise(r => setTimeout(r, 350));
            setApplyPhase('import');

            try {
                const id = await insertSubscription(url);
                if (!id) throw new Error(t('add_subscription_failed'));
                await setStoreValue(SSI_STORE_KEY, id);
                await Promise.all([
                    swrMutate(GET_SUBSCRIPTIONS_LIST_SWR_KEY),
                    vpnServiceManager.stop().catch(() => { }),
                ]);
            } catch {
                setApplyErrorMessage(t('add_subscription_failed'));
                setApplyPhase('error');
                return;
            }

            // Snapshot the current engine epoch; only transitions past this
            // epoch count for the apply-modal 'done' check.
            applyEpochRef.current = engineState.epoch;
            setApplyPhase('start');

            performSyncAndStart(async (error) => {
                setApplyErrorMessage(
                    typeof error === 'string' && error
                        ? error
                        : t('connect_failed')
                );
                setApplyPhase('error');
            });
        })();
    }, [deepLinkApplyUrl]);

    const startService = async (isEmpty: boolean) => {
        if (isEmpty) {
            setActiveScreen('configuration');
            return message(t('please_add_subscription'), { title: t('tips'), kind: 'error' });
        }
        performSyncAndStart(async (error) => {
            console.error('同步配置失败:', error);
            await stopService();
        });
    };

    const restartService = async (isEmpty: boolean) => {
        if (isEmpty) {
            setActiveScreen('configuration');
            return message(t('please_add_subscription'), { title: t('tips'), kind: 'error' });
        }
        try {
            vpnServiceManager.syncConfig({});
            vpnServiceManager.reload(1000);
        } catch (error) {
            console.error('重启服务失败:', error);
            await message(t('reconnect_failed'), { title: t('error'), kind: 'error' });
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
                await startService(isEmpty);
            }
        } catch (error) {
            console.error('连接失败:', error);
            await message(`${t('connect_failed')}: ${error}`, { title: t('error'), kind: 'error' });
        }
    };

    return {
        operationStatus,
        isLoading,
        isRunning,
        startService,
        restartService,
        toggleService,
        applyPhase,
        applyErrorMessage,
        closeApplyModal,
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