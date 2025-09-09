import { listen } from "@tauri-apps/api/event";
import { type } from "@tauri-apps/plugin-os";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { ArrowRepeat } from "react-bootstrap-icons";
import { mutate } from "swr";
import { addSubscription, updateSubscription } from "../action/db";
import { SubscriptionItem } from "../components/configuration/item";
import { AddSubConfigurationModal } from "../components/configuration/modal";
import { useSubscriptions } from "../hooks/useDB";
import { getStoreValue } from "../single/store";
import { GET_SUBSCRIPTIONS_LIST_SWR_KEY, SUPPORT_LOCAL_FILE_STORE_KEY } from "../types/definition";
import { t } from "../utils/helper";



function ConfigurationNav({ onUpdateAllSubscriptions }: { onUpdateAllSubscriptions?: () => Promise<void> }) {
    const [isUpdating, setIsUpdating] = useState(false);
    const [isHovering, setIsHovering] = useState(false);

    const handleUpdateAll = async () => {
        setIsUpdating(true);
        try {
            onUpdateAllSubscriptions && await onUpdateAllSubscriptions();
        } finally {
            setIsUpdating(false);
        }
    };

    useEffect(() => {

        const setupListener = async () => {
            const unListen = await listen('tauri://drag-drop', async event => {
                const flag = await getStoreValue(SUPPORT_LOCAL_FILE_STORE_KEY, false)
                if (!flag) {
                    console.log('Local file import is disabled');
                    return
                }
                let fileName = "";
                let path = `file://${(event as any).payload.paths[0]}`

                console.log('File dropped:', event);

                // zh:对不同操作系统的路径分隔符进行处理
                // en:Handle path separators for different operating systems
                if (type() == "windows") {
                    fileName = (event as any).payload.paths[0].split('\\').pop()
                } else {
                    fileName = (event as any).payload.paths[0].split('/').pop()
                }

                await addSubscription(path, fileName)
                await mutate(GET_SUBSCRIPTIONS_LIST_SWR_KEY)
            })
            return unListen
        }

        let unListenPromise = setupListener()

        return () => {
            unListenPromise.then(unListen => unListen())
        }

    }, [])

    return (
        <div className="flex justify-between items-center p-2">
            <h3 className="text-gray-500 text-sm font-bold capitalize">
                {t("subscription_management")}
            </h3>
            <div className="flex items-center gap-2">
                {onUpdateAllSubscriptions && (<button
                    className="btn btn-xs btn-ghost btn-circle border-0 transition-colors"
                    onMouseEnter={() => setIsHovering(true)}
                    onMouseLeave={() => setIsHovering(false)}
                    onClick={handleUpdateAll}
                    disabled={isUpdating}
                >
                    <motion.div
                        animate={{ rotate: isUpdating ? 360 : (isHovering ? 180 : 0) }}
                        transition={{
                            duration: isUpdating ? 1 : 0.3,
                            ease: "easeInOut",
                            repeat: isUpdating ? Infinity : 0
                        }}
                    >
                        <ArrowRepeat className="size-4 text-blue-600" />
                    </motion.div>
                </button>)}

                <AddSubConfigurationModal />
            </div>
        </div>
    );
}

export default function Configuration() {
    const { data } = useSubscriptions();

    const onUpdateAllSubscriptions = async () => {
        if (data) {
            for (const item of data) {
                try {
                    await updateSubscription(item.identifier);
                } catch (err) {
                    console.error(`Failed to update subscription ${item.identifier}:`, err);
                }
            }
        }
    };


    return (
        <div
            className="h-full mb-4 w-full"
        >
            <ConfigurationNav onUpdateAllSubscriptions={(data && data.length > 0) ? onUpdateAllSubscriptions : undefined} />
            <ConfigurationBody />
        </div>
    )
}


export function ConfigurationBody() {
    const [expanded, setExpanded] = useState("")
    const { data, error, isLoading } = useSubscriptions()

    if (isLoading) {
        return (
            <div className="flex justify-center items-center mt-24">
                <p className="text-gray-500 text-sm">{t("loading")}</p>
            </div>
        )
    }

    if (error) {
        return (
            <div className="flex justify-center items-center mt-24">
                <p className="text-red-500 text-sm">{JSON.stringify(error)}</p>
            </div>
        )
    }

    if (!data) {
        return (
            <div className="flex justify-center items-center mt-24 ">
                <p className="text-gray-500 text-sm">
                    {t("no_subscription_config")}
                </p>
            </div>
        )
    }


    return (
        <ul className="list bg-base-100 rounded-box m-2  overflow-y-auto max-h-[410px]">
            {
                data.map((item) => {
                    return <SubscriptionItem
                        key={item.identifier}
                        item={item}
                        expanded={expanded}
                        setExpanded={setExpanded}
                    ></SubscriptionItem>
                })
            }
        </ul>
    )

}