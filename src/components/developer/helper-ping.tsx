import { invoke } from "@tauri-apps/api/core";
import { type } from "@tauri-apps/plugin-os";
import { PlayCircle, ShieldCheck, ShieldLock } from "react-bootstrap-icons";
import { toast } from "sonner";
import { SettingItem } from "./common";

// Phase 1c developer-only probes for the macOS privileged helper. Two items:
//
//   1. `helper_install` -> SMJobBless flow. Triggers the macOS authorization
//      prompt the first time; subsequent calls are a fast no-op.
//   2. `helper_ping` -> XPC round-trip. Only succeeds after install has run.
//
// Both commands run on the backend through helper_client.m. The install path
// only works when the app was launched from a signed, notarized bundle with
// SMPrivilegedExecutables patched into Info.plist — i.e. after running
// scripts/integrate-helper-into-bundle.sh against the production build.
// Running from `tauri dev` will fail with a signature mismatch; that's
// expected and documented in src-tauri/helper/README.md.
export default function HelperPing() {
    if (type() !== "macos") return null;

    const onInstall = async () => {
        try {
            await invoke("helper_install");
            toast.success("helper installed");
        } catch (e) {
            toast.error(`install failed: ${e}`);
        }
    };

    const onPing = async () => {
        try {
            const reply = await invoke<string>("helper_ping");
            toast.success(`helper: ${reply}`);
        } catch (e) {
            toast.error(`helper error: ${e}`);
        }
    };

    const onSmokeTest = async () => {
        // Phase 2b.1 probe: start sing-box via helper with the main app's
        // existing config, wait 3 s, stop it. Temporary — Phase 2b.2 will
        // wire the real start/stop into vpn/macos and this button goes
        // away along with the underlying tauri command.
        const paths = await invoke<{ data_dir: string }>("get_app_paths");
        const configPath = `${paths.data_dir}/config.json`;
        try {
            const result = await invoke<string>("helper_smoke_test", { configPath });
            toast.success(result);
        } catch (e) {
            toast.error(`smoke test failed: ${e}`);
        }
    };

    return (
        <>
            <SettingItem
                icon={<ShieldLock className="text-[#FF9500]" size={22} />}
                title="Install privileged helper"
                subTitle="SMJobBless — first call shows the system prompt"
                onPress={onInstall}
            />
            <SettingItem
                icon={<ShieldCheck className="text-[#30B0C7]" size={22} />}
                title="Privileged helper ping"
                subTitle="XPC round-trip — requires install to have run"
                onPress={onPing}
            />
            <SettingItem
                icon={<PlayCircle className="text-[#34C759]" size={22} />}
                title="Helper smoke test (start/stop sing-box)"
                subTitle="Phase 2b.1 — starts then stops sing-box via helper"
                onPress={onSmokeTest}
            />
        </>
    );
}
