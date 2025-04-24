import { useState } from "react";
import { Sliders } from "react-bootstrap-icons";
import MacOSDevPage from "./devtool/macos-root";


export default function Page() {
    const [route, setRoute] = useState<string>('macos');
    return (<>
        <div className="dropdown dropdown-bottom">
            <div tabIndex={0} role="button" className="btn btn-xs m-1">
                <Sliders></Sliders>
            </div>
            <ul tabIndex={0} className="dropdown-content menu bg-base-100 rounded-box z-1 w-52 p-2 shadow-sm">
                <li>
                    <a onClick={() => {
                        setRoute('macos');
                    }}>macOS 特权模式</a>
                </li>
                <li>
                    <a onClick={() => {
                        setRoute('other');
                    }}>其他</a>
                </li>
            </ul>
        </div>
        {
            route === 'macos' ? <MacOSDevPage></MacOSDevPage> : <></>
        }
    </>)
}