import { useState } from "react";
import { SubscriptionItem } from "../components/configuration/item";
import { AddSubConfigurationModal } from "../components/configuration/modal";
import { useSubscriptions } from "../hooks/useDB";


export default function Configuration() {
    const [expanded, setExpanded] = useState("")
    const { data, error, isLoading } = useSubscriptions()
    console.log("data", data)
    console.log("error", error)
    console.log("isLoading", isLoading)

    return <>
        <div className="h-full mb-4 w-full">

            <div className="p-2 flex justify-between items-center">
                <h3 className="text-gray-500  text-sm  font-bold">订阅管理</h3>
                <AddSubConfigurationModal ></AddSubConfigurationModal>
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