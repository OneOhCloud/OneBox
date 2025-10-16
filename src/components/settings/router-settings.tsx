import { useContext } from "react";
import { SignIntersectionY } from "react-bootstrap-icons";
import { NavContext } from "../../single/context";
import { t } from "../../utils/helper";
import { SettingItem } from "./common";

export default function RouterSettingsItem() {
    const { setActiveScreen } = useContext(NavContext);

    return (
        <div>
            <SettingItem
                icon={<SignIntersectionY className="text-[#007AFF]" size={22} />}
                title={t("router_settings", "Router Settings")}
                onPress={() => setActiveScreen('router_settings')}
            />
        </div>
    )
}