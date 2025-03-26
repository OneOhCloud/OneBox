import { useState } from "react";

type SelectNodeProps = {
    nodeList: string[]
}


export default function SelectNode(props: SelectNodeProps) {
    const { nodeList } = props;
    const [selectedNode, setSelectedNode] = useState(nodeList[0] || '');

    const handleNodeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        setSelectedNode(e.target.value);
    };

    if (nodeList.length === 0) {
        return <div className="select select-sm w-full flex items-center justify-center text-gray-500 bg-gray-100 border border-gray-300 rounded-md">
            当前配置没有节点
        </div>
    }

    return (


        <div className="relative">
            <select
                value={selectedNode}
                onChange={handleNodeChange}
                className="select select-sm w-full  text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none"
            >
                {nodeList.map((item, index) => (
                    <option key={index} className="py-1">{item}</option>
                ))}

            </select>
        </div>
    )
}