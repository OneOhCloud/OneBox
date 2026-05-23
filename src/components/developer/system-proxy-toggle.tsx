import { useEffect, useState } from "react";
import { Diagram3 } from "react-bootstrap-icons";
import { getEnableTun, getSkipSystemProxy, setSkipSystemProxy } from "../../single/store";
import { t } from "../../utils/helper";
import { ToggleSetting } from "./common";

export default function ToggleSystemProxyOnStart() {
    const [skipSystemProxy, setSkipSystemProxyState] = useState(false);
    const [tunEnabled, setTunEnabled] = useState(false);

    useEffect(() => {
        const loadState = async () => {
            try {
                setSkipSystemProxyState(await getSkipSystemProxy());
                setTunEnabled(await getEnableTun());
            } catch (error) {
                console.warn("Error loading system proxy toggle state, defaulting to false.");
            }
        };

        loadState();
        const loadStateID = setInterval(loadState, 500);
        return () => clearInterval(loadStateID);
    }, []);

    const handleToggle = async () => {
        const next = !skipSystemProxy;
        setSkipSystemProxyState(next);
        try {
            await setSkipSystemProxy(next);
        } catch (error) {
            setSkipSystemProxyState(!next);
            console.error("Error saving system proxy toggle state:", error);
        }
    };

    if (tunEnabled) {
        return null;
    }

    return (
        <ToggleSetting
            icon={<Diagram3 className="text-[#5856D6]" size={22} />}
            title={t("skip_system_proxy")}
            subTitle={t("skip_system_proxy_desc")}
            isEnabled={skipSystemProxy}
            onToggle={handleToggle}
        />
    );
}
