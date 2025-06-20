import { openUrl } from "@tauri-apps/plugin-opener"
import bytes from "bytes"
import { AnimatePresence, motion } from "framer-motion"
import { useState } from "react"
import { ArrowClockwise, CaretDownFill, CaretUpFill, Trash } from "react-bootstrap-icons"
import { mutate } from "swr"
import { deleteSubscription, updateSubscription } from "../../action/db"
import { contentVariants, itemVariants } from "../../page/variants"
import { GET_SUBSCRIPTIONS_LIST_SWR_KEY, Subscription } from "../../types/definition"
import { t } from "../../utils/helper"
import Avatar from "./avatar"

interface SubscriptionItemProps {
    item: Subscription
    expanded: string
    setExpanded: (id: string) => void
}

interface ItemDetailsProps {
    identifier: string
    visible: boolean
    remainingDays: string
    trafficDetails: string
}

const ANIMATION_STYLES = {
    willChange: "transform, opacity, height, clip-path",
    backfaceVisibility: "hidden" as const
}

const ItemDetails: React.FC<ItemDetailsProps> = ({
    identifier,
    visible,
    remainingDays,
    trafficDetails
}) => {
    const [isUpdating, setIsUpdating] = useState(false)

    const handleUpdateClick = async () => {
        setIsUpdating(true)
        try {
            await updateSubscription(identifier)
            await mutate(GET_SUBSCRIPTIONS_LIST_SWR_KEY)
        } catch (error) {
            console.error("Failed to update subscription:", error)
        } finally {
            setIsUpdating(false)
        }
    }

    const handleDelete = async () => {
        await deleteSubscription(identifier)
        await mutate(GET_SUBSCRIPTIONS_LIST_SWR_KEY)
    }

    return (
        <AnimatePresence initial={false}>
            {visible && (
                <motion.div
                    variants={itemVariants}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    key={identifier}
                    className="overflow-hidden"
                    style={ANIMATION_STYLES}
                >
                    <motion.div
                        variants={contentVariants}
                        className="flex flex-col gap-2 px-4 py-4 bg-gray-100 rounded-b"
                    >
                        <div className="flex flex-col gap-2">
                            <div className="flex items-center justify-between">
                                <div className="flex gap-2">
                                    <span className="text-xs text-gray-400 capitalize">{t("remaining_traffic")}</span>
                                    <span className="text-xs text-blue-500">{trafficDetails}</span>
                                </div>
                                <button
                                    className="btn btn-xs btn-ghost btn-circle border-0"
                                    onClick={handleUpdateClick}
                                    disabled={isUpdating}
                                >
                                    {isUpdating ? (
                                        <span className="text-gray-400 size-[0.8rem] loading loading-spinner" />
                                    ) : (
                                        <ArrowClockwise className="size-[0.8rem] text-gray-400" />
                                    )}
                                </button>
                            </div>

                            <div className="flex items-center justify-between">
                                <div className="flex gap-2">
                                    <span className="text-xs text-gray-400 capitalize">{t("remaining_days")}</span>
                                    <span className="text-xs text-blue-500">{remainingDays}</span>
                                </div>
                                <button
                                    className="btn btn-xs btn-ghost btn-circle border-0 transition-colors"
                                    onClick={handleDelete}
                                >
                                    <Trash className="size-[0.8rem] text-gray-400" />
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}

export const SubscriptionItem: React.FC<SubscriptionItemProps> = ({
    item,
    expanded,
    setExpanded
}) => {
    const usage = Math.floor((item.used_traffic / item.total_traffic) * 100)
    const remainingDays = Math.floor((item.expire_time - item.last_update_time) / (1000 * 60 * 60 * 24))
    const trafficDetailsText = `${bytes(item.used_traffic)}/${bytes(item.total_traffic)}`
    const remainingDaysText = `${remainingDays} ${t("days")}`

    const handleToggleExpand = () => setExpanded(expanded === item.identifier ? '' : item.identifier)
    const handleWebsiteClick = () => openUrl(item.official_website)

    return (
        <li key={item.identifier}>
            <div className="list-row items-center">
                <div onClick={handleWebsiteClick}>
                    <Avatar url={item.official_website} />
                </div>
                <div className="max-w-[160px] flex flex-col gap-2">
                    <div className="truncate text-sm">{item.name}</div>
                    <div className="text-xs flex items-center">
                        <progress className="progress h-1" value={usage} max="100" />
                    </div>
                </div>
                <button
                    className="btn btn-ghost btn-xs btn-circle border-0 transition-colors"
                    onClick={handleToggleExpand}
                >
                    {expanded === item.identifier ? (
                        <CaretUpFill className="size-[0.8rem]" />
                    ) : (
                        <CaretDownFill className="size-[0.8rem]" />
                    )}
                </button>
            </div>

            <ItemDetails
                identifier={item.identifier}
                visible={expanded === item.identifier}
                remainingDays={remainingDaysText}
                trafficDetails={trafficDetailsText}
            />
        </li>
    )
}