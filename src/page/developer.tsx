import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Binoculars } from "react-bootstrap-icons";
import ToggleBypassRouter from "../components/developer/bypass-router";
import { SettingItem } from "../components/developer/common";
import ToggleDev from "../components/developer/dev-toggle";
import ToggleDHCP from "../components/developer/dhcp-toggle";
import DNSSettingsItem from "../components/developer/dns-settings";
import HelperPing from "../components/developer/helper-ping";
import ToggleLocalConfig from "../components/developer/local-config-toggle";
import StageSetting from "../components/developer/select-stage";
import TunStackSetting from "../components/developer/tun-stack";
import UASettingsItem from "../components/developer/ua-settings";
import { t } from "../utils/helper";

const appWindow = getCurrentWindow();

export default function Page() {
    return (
        <div className="onebox-scrollpage">
            <div className="onebox-page-inner">
                <div className="onebox-grouped-card mb-5">
                    <ToggleDev />
                    <ToggleDHCP />
                    <ToggleBypassRouter />
                    <ToggleLocalConfig />
                </div>

                <div className="onebox-grouped-card">
                    <StageSetting />
                    <TunStackSetting />
                    <DNSSettingsItem />
                    <UASettingsItem />
                    <HelperPing />
                    <SettingItem
                        icon={<Binoculars className="w-5 h-5 text-gray-500" />}
                        title={t("open_advanced_settings")}
                        subTitle={t("open_log_desc")}
                        disabled={false}
                        onPress={() => {
                            invoke('create_window', {
                                app: appWindow,
                                title: "Log",
                                label: "sing-box-log",
                                windowTag: "sing-box-log",
                            })
                        }}
                    />
                </div>
            </div>
        </div>
    );
}
