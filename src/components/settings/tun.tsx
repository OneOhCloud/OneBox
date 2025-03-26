import { useEffect, useState } from "react";
import { ToggleSetting } from "./common";
import { Cpu } from "react-bootstrap-icons";
import { store } from "../../single/store";


export default function ToggleTun() {
    const [toggle, setToggle] = useState(false);

    useEffect(() => {
        const loadTunState = async () => {
            try {
                const state: boolean | undefined = await store.get('tun');
                if (state !== undefined) {
                    setToggle(state);
                } else {
                    setToggle(false);
                }
            } catch (error) {
                console.error("Failed to load tun state:", error);
            }
        };

        loadTunState();
    }, []);

    const handleToggle = async () => {
        setToggle(!toggle);
        await store.set('tun', !toggle);
        await store.save();
    }





    return (
        <ToggleSetting
            icon={<Cpu className="text-[#5856D6]" size={22} />}
            title="Tun 模式"
            subTitle="接管所有流量"
            isEnabled={toggle}
            onToggle={handleToggle}
        />
    );
}