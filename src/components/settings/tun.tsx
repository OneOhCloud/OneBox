import { useState } from "react";
import { ToggleSetting } from "./common";
import { Cpu } from "react-bootstrap-icons";


export default function ToggleTun() {
    const [on, setOn] = useState(false);

    return (<ToggleSetting
        icon={<Cpu className="text-[#5856D6]" size={22} />}
        title="Tun 模式"
        subTitle="接管所有流量"
        isEnabled={on}
        onToggle={() => setOn(!on)}
    />)
}