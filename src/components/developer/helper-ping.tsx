import { invoke } from "@tauri-apps/api/core";
import { ShieldCheck, ShieldLock } from "react-bootstrap-icons";
import { toast } from "sonner";
import { t } from "../../utils/helper";
import { SettingItem } from "./common";

// Developer-only probes for the platform's privileged companion:
//   - macOS: XPC helper installed via SMJobBless.
//   - Windows: OneBoxTunService installed via SCM (UAC on first install).
//   - Linux: helper script + polkit policy installed by the .deb/.rpm;
//     "install" is a no-op that just verifies the script is on disk.
//
// On macOS, install only works from a signed, notarized bundle with
// SMPrivilegedExecutables patched into Info.plist — `tauri dev` will
// fail with a signature mismatch. See src-tauri/helper/README.md.
export default function HelperPing() {
    const onInstall = async () => {
        try {
            await invoke("engine_ensure_installed");
            toast.success(t("helper_installed"));
        } catch (e) {
            toast.error(`${t("helper_install_failed")}: ${e}`);
        }
    };

    const onProbe = async () => {
        try {
            const reply = await invoke<string>("engine_probe");
            toast.success(`${t("helper_probe_reply")}: ${reply}`);
        } catch (e) {
            toast.error(`${t("helper_probe_failed")}: ${e}`);
        }
    };

    return (
        <>
            <SettingItem
                icon={<ShieldLock className="text-[#FF9500]" size={22} />}
                title={t("helper_install_title")}
                subTitle={t("helper_install_subtitle")}
                onPress={onInstall}
            />
            <SettingItem
                icon={<ShieldCheck className="text-[#30B0C7]" size={22} />}
                title={t("helper_probe_title")}
                subTitle={t("helper_probe_subtitle")}
                onPress={onProbe}
            />
        </>
    );
}
