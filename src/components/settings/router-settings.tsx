import { SignIntersectionY } from "react-bootstrap-icons";
import { t } from "../../utils/helper";
import { SettingItem } from "./common";

export default function RouterSettingsItem() {


    return (
        <div>
            <SettingItem
                icon={<SignIntersectionY className="text-[#007AFF]" size={22} />}
                title={t("router_settings", "Router Settings")}
                onPress={() => { }}
            />
        </div>
    )
}