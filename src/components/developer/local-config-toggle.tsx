import { useEffect, useState } from "react";
import { FileEarmarkArrowDown } from "react-bootstrap-icons";
import { getStoreValue, setStoreValue } from "../../single/store";
import { SUPPORT_LOCAL_FILE_STORE_KEY } from "../../types/definition";
import { t } from "../../utils/helper";
import { ToggleSetting } from "./common";



export default function ToggleLocalConfig() {
    const [toggle, setToggle] = useState(false);

    useEffect(() => {
        const loadState = async () => {
            try {
                const state: boolean = await getStoreValue(SUPPORT_LOCAL_FILE_STORE_KEY, false);
                setToggle(state);
            } catch (error) {
                console.warn("Error loading developer toggle state, defaulting to false.");
            }
        };

        loadState();
    }, []);

    const handleToggle = async () => {
        setToggle(!toggle);
        try {
            await setStoreValue(SUPPORT_LOCAL_FILE_STORE_KEY, !toggle);
        } catch (error) {
            console.error("Error saving developer toggle state:", error);
        }

    }


    return (
        <ToggleSetting
            icon={<FileEarmarkArrowDown className="text-[#5856D6]" size={22} />}
            title={t("drag_config")}
            subTitle={t("drag_config_desc")}
            isEnabled={toggle}
            onToggle={handleToggle}
        />
    );
}