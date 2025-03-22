import { motion } from "framer-motion";
import { useState } from "react";
import { Plus } from "react-bootstrap-icons";
import { SubscriptionItem } from "../components/configuration/item";
import { useSubscriptions } from "../hooks/useSql";


export default function Configuration() {
    const [isHovering, setIsHovering] = useState(false);
    const [expanded, setExpanded] = useState("")
    const { data, error, isLoading } = useSubscriptions()
    console.log("data", data)
    console.log("error", error)
    console.log("isLoading", isLoading)

    const handleItemClick = (id: string) => {
        // @ts-ignore
        document.getElementById(id).showModal()
    }


    return <>
        <div className="h-full mb-4 w-full">
            <dialog id="addSubConfigurationModal" className="modal">
                <div className="modal-box bg-white">
                    <h3 className="font-bold text-lg">添加订阅</h3>
                    <div className="flex flex-col gap-8 mt-8">
                        <input type="text" placeholder="名称" className="input input-sm" />
                        <input type="text" placeholder="地址: https://xxxxxxxx" className="input input-sm" />
                    </div>

                    <div className="modal-action">
                        <button className="btn btn-ghost btn-sm">添加</button>
                        <form method="dialog" >
                            <button className="btn btn-ghost btn-sm">关闭</button>
                        </form>
                    </div>
                </div>
            </dialog>
            <div className="p-2 flex justify-between items-center">
                <h3 className="text-gray-500  text-sm  font-bold">订阅管理</h3>
                <button
                    className="btn btn-xs btn-ghost btn-circle  border-0  transition-colors"
                    onMouseEnter={() => setIsHovering(true)}
                    onMouseLeave={() => setIsHovering(false)}
                    onClick={() => handleItemClick("addSubConfigurationModal")}
                >
                    <motion.div
                        animate={{ rotate: isHovering ? 90 : 0 }}
                        transition={{ duration: 0.3, ease: "easeInOut" }}
                    >
                        <Plus className="size-6 text-blue-600" />
                    </motion.div>
                </button>
            </div>
            {data?.length === 0 && (
                <div className="flex justify-center items-center h-full">
                    <p className="text-gray-500 text-sm">没有订阅</p>
                </div>
            )}



            <ul className="list bg-base-100 rounded-box m-2  overflow-y-auto max-h-[410px]">
                {
                    data?.map((item) => {
                        return <SubscriptionItem
                            key={item.identifier}
                            item={item}
                            expanded={expanded}
                            setExpanded={setExpanded}
                        ></SubscriptionItem>
                    })
                }
            </ul>
        </div>
    </>
}