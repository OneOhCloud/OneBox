import { confirm } from '@tauri-apps/plugin-dialog';
import { relaunch } from '@tauri-apps/plugin-process';
import { t, vpnServiceManager } from "../../utils/helper";
import { useUpdate } from './update-context';

export default function UpdaterButton() {
    const { updateInfo, downloadComplete } = useUpdate();

    const handleInstall = async () => {
        if (!updateInfo || !downloadComplete) return;

        try {
            const confirmed = await confirm(t("update_downloaded"), {
                title: t("update_install"),
                kind: 'info',
            });

            if (confirmed) {
                await vpnServiceManager.stop();
                // 延迟2秒等待服务完全停止
                await new Promise(resolve => setTimeout(resolve, 2000));
                await updateInfo.install();
                await relaunch();
            }
        } catch (error) {
            console.error('Installation error:', error);
        }
    };

    if (!downloadComplete || !updateInfo) {
        return null;
    }

    return (
        <button
            className="btn btn-xs btn-secondary"
            onClick={handleInstall}
        >
            {t("install_new_update")}
        </button>
    );
}