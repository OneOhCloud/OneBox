import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm } from '@tauri-apps/plugin-dialog';
import { useState } from "react";
import useSWR from "swr";
import { t } from "../../utils/helper";

type NetworkResponse = {
    status: boolean | string;
    needsLogin?: boolean;
    loginUrl?: string;
};

export function useNetworkCheck(key: string, checkFn: () => Promise<NetworkResponse>) {
    const [shouldRefresh, setShouldRefresh] = useState(true);
    const [confirmShown, setConfirmShown] = useState(false);

    async function handleNetworkCheck() {
        if (!shouldRefresh) {
            return { status: false };
        }

        try {
            const response = await checkFn();

            if (response.needsLogin && !confirmShown) {
                setShouldRefresh(false);
                setConfirmShown(true);

                const answer = await confirm(t("network_need_login"), {
                    title: t("network_need_login_title"),
                    kind: 'warning',
                });

                if (answer && response.loginUrl) {
                    setConfirmShown(false);
                    await invoke('open_browser', {
                        app: getCurrentWindow(),
                        url: response.loginUrl
                    });
                }

                setTimeout(() => {
                    setShouldRefresh(true);
                    setConfirmShown(false);
                }, 15000);
            }

            return response;
        } catch (error) {
            console.error(`Network check failed: ${error}`);
            return { status: false };
        }
    }

    return useSWR(key, handleNetworkCheck, {
        refreshInterval: 1000
    });
}

export function useAppleNetworkCheck() {
    async function checkAppleNetwork() {
        const res = await invoke<string>('ping_captive');
        console.log("Apple network check result:", res);
        return {
            status: res === "true",
            needsLogin: res.startsWith("http"),
            loginUrl: res.startsWith("http") ? res : undefined
        };
    }

    return useNetworkCheck(
        `apple-network-check`,
        checkAppleNetwork
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
