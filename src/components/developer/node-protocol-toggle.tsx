import { useEffect, useState } from "react";
import { Tag } from "react-bootstrap-icons";
import { getShowNodeProtocol, setShowNodeProtocol } from "../../single/store";
import { t } from "../../utils/helper";
import { ToggleSetting } from "./common";


export default function ToggleNodeProtocol() {
    const [toggle, setToggle] = useState(false);

    useEffect(() => {
        const loadState = async () => {
            try {
                const state: boolean = await getShowNodeProtocol();
                setToggle(state);
            } catch (error) {
                console.warn("Error loading node protocol state, defaulting to false.");
            }
        };
        loadState();
    }, []);

    const handleToggle = async () => {
        const next = !toggle;
        setToggle(next);
        try {
            await setShowNodeProtocol(next);
        } catch (error) {
            console.error("Error saving node protocol state:", error);
        }
    };

    return (
        <ToggleSetting
            icon={<Tag className="text-[#5856D6]" size={22} />}
            title={t("show_node_protocol")}
            subTitle={t("show_node_protocol_desc")}
            isEnabled={toggle}
            onToggle={handleToggle}
        />
    );
}
