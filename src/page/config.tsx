import { useState } from "react";
import { SubscriptionItem } from "../components/configuration/item";
import { AddSubConfigurationModal } from "../components/configuration/modal";
import { useSubscriptions } from "../hooks/useDB";
import { t } from "../utils/helper";


export default function Configuration() {
    const [expanded, setExpanded] = useState("")
    const { data, error, isLoading } = useSubscriptions()
    console.log("data", data)
    console.log("error", error)
    console.log("isLoading", isLoading)

    return (<div className="h-full mb-4 w-full">

        <div className="p-2 flex justify-between items-center">
            <h3 className="text-gray-500  text-sm  font-bold  capitalize">{
                t("subscription_management")
            }</h3>
            <AddSubConfigurationModal ></AddSubConfigurationModal>
        </div>

        {data?.length === 0 && (
            <div className="flex justify-center items-center mt-24 ">
                <p className="text-gray-500 text-sm">
                    {t("no_subscription_config")}
                </p>
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
    )

}