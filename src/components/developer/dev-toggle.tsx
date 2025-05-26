import { useEffect, useState } from "react";
import { WrenchAdjustableCircle } from "react-bootstrap-icons";
import { getStoreValue, setStoreValue } from "../../single/store";
import { DEVELOPER_TOGGLE_STORE_KEY } from "../../types/definition";
import { t } from "../../utils/helper";
import { ToggleSetting } from "./common";



export default function ToggleDev() {
    const [toggle, setToggle] = useState(false);

    useEffect(() => {
        const loadState = async () => {
            try {
                const state: boolean = await getStoreValue(DEVELOPER_TOGGLE_STORE_KEY, false);
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
            await setStoreValue(DEVELOPER_TOGGLE_STORE_KEY, !toggle);
        } catch (error) {
            console.error("Error saving developer toggle state:", error);
        }

    }


    return (
        <ToggleSetting
            icon={<WrenchAdjustableCircle className="text-[#5856D6]" size={22} />}
            title={t("developer_toggle")}
            subTitle={t("developer_toggle_desc")}
            isEnabled={toggle}
            onToggle={handleToggle}
        />
    );
}