import { invoke } from "@tauri-apps/api/core";
import { ShieldCheck, ShieldLock } from "react-bootstrap-icons";
import { toast } from "sonner";
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
            toast.success("privileged companion installed");
        } catch (e) {
            toast.error(`install failed: ${e}`);
        }
    };

    const onProbe = async () => {
        try {
            const reply = await invoke<string>("engine_probe");
            toast.success(`companion: ${reply}`);
        } catch (e) {
            toast.error(`probe failed: ${e}`);
        }
    };

    return (
        <>
            <SettingItem
                icon={<ShieldLock className="text-[#FF9500]" size={22} />}
                title="Install privileged companion"
                subTitle="SMJobBless / SCM install — first call shows the system prompt"
                onPress={onInstall}
            />
            <SettingItem
                icon={<ShieldCheck className="text-[#30B0C7]" size={22} />}
                title="Probe privileged companion"
                subTitle="Round-trip liveness check — requires install to have run"
                onPress={onProbe}
            />
        </>
    );
}
