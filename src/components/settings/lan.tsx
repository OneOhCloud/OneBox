import { useState } from "react";
import { ToggleSetting } from "./common";
import { Router } from "react-bootstrap-icons";


export default function ToggleLan() {
    const [lanEnabled, setLanEnabled] = useState(false);
    return (
        <ToggleSetting
        icon={<Router className="text-[#5856D6]" size={22} />}
        title="允许局域网连接"
        subTitle="127.0.0.1:6789"
        isEnabled={lanEnabled}
        onToggle={() => setLanEnabled(!lanEnabled)}
      />
    )
}