import { useEffect, useState } from "react";
import { LightningCharge } from "react-bootstrap-icons";
import { toast } from "sonner";
import { getAutoConnect, setAutoConnect } from "../../single/store";
import { t } from "../../utils/helper";
import { ToggleSetting } from "./common";

export default function ToggleAutoConnect() {
    const [toggle, setToggle] = useState(false);

    useEffect(() => {
        const loadState = async () => {
            try {
                setToggle(await getAutoConnect());
            } catch (error) {
                console.error("Failed to load auto connect state:", error);
            }
        };
        loadState();
    }, []);

    const handleToggle = async () => {
        const next = !toggle;
        setToggle(next);
        try {
            await setAutoConnect(next);
        } catch (error) {
            setToggle(!next);
            console.error("Failed to save auto connect state:", error);
            toast.error(t("auto_connect_failed"));
        }
    };

    return (
        <ToggleSetting
            icon={<LightningCharge className="text-[#FF9500]" size={22} />}
            title={t("auto_connect")}
            subTitle={t("auto_connect_desc")}
            isEnabled={toggle}
            onToggle={handleToggle}
        />
    );
}
