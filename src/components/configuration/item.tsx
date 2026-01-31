import { openUrl } from "@tauri-apps/plugin-opener"
import bytes from "bytes"
import { AnimatePresence, motion } from "framer-motion"
import { useEffect } from "react"
import { ArrowClockwise, CaretDownFill, CaretUpFill, Trash } from "react-bootstrap-icons"
import { mutate } from "swr"
import { deleteSubscription } from "../../action/db"
import { useUpdateSubscription } from "../../action/subscription-hooks"
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
    onUpdate: () => Promise<void>
    loading: boolean
}

const ANIMATION_STYLES = {
    willChange: "transform, opacity, height, clip-path",
    backfaceVisibility: "hidden" as const
}


function ItemDetailsSkeleton() {
    return (
        <AnimatePresence initial={true}>
            <motion.div
                variants={itemVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
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
                                <div className="bg-gray-300 h-4 w-20 rounded animate-pulse" />
                            </div>
                            <div className="bg-gray-300 rounded-full size-6 animate-pulse" />
                        </div>

                        <div className="flex items-center justify-between">
                            <div className="flex gap-2">
                                <div className="bg-gray-300 h-4 w-20 rounded animate-pulse" />
                            </div>
                            <div className="bg-gray-300 rounded-full size-6 animate-pulse" />
                        </div>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    )
}

const ItemDetails: React.FC<ItemDetailsProps> = ({
    identifier,
    visible,
    remainingDays,
    trafficDetails,
    onUpdate,
    loading
}) => {

    const handleUpdateClick = async () => {
        try {
            await onUpdate()
            await mutate(GET_SUBSCRIPTIONS_LIST_SWR_KEY)
        } catch (error) {
            console.error("Failed to update subscription:", error)
        } finally {
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
                                    disabled={loading}
                                >
                                    {loading ? (
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



type SubscriptionItemSkeletonProps = {
    expanded: boolean
}

function SubscriptionItemSkeleton(props: SubscriptionItemSkeletonProps) {
    return (
        <li>
            <div className="list-row items-center">
                <div className="bg-gray-300 rounded-full size-10 animate-pulse" />
                <div className="max-w-40 flex flex-col gap-2">
                    <div className=" truncate text-sm animate-pulse text-gray-500" >{t('updating')}</div>
                    <div className="bg-gray-300 text-xs flex items-center " >
                        <progress
                            className="progress h-1 animate-pulse"
                            value={0}
                            max="100"
                        />
                    </div>
                </div>
                <button
                    className="btn btn-ghost btn-xs btn-circle border-0 transition-colors animate-pulse"
                >
                    <div className="size-[0.8rem] bg-gray-300 rounded-full" />

                </button>
            </div>
            {
                props.expanded && <ItemDetailsSkeleton />
            }
        </li>
    )
}


export const SubscriptionItem: React.FC<SubscriptionItemProps> = ({
    item,
    expanded,
    setExpanded
}) => {

    const usage = Math.floor((item.used_traffic / item.total_traffic) * 100)
    const remainingDays = Math.floor((item.expire_time - item.last_update_time) / (1000 * 60 * 60 * 24))
    const trafficDetailsText = `${bytes(item.used_traffic)} /${bytes(item.total_traffic)}`
    const remainingDaysText = `${remainingDays} ${t("days")}`
    const handleToggleExpand = () => setExpanded(expanded === item.identifier ? '' : item.identifier)
    const handleWebsiteClick = () => openUrl(item.official_website)
    const { update, resetMessage, loading, message, messageType } = useUpdateSubscription()



    useEffect(() => {
        if (!loading) {
            const timer = setTimeout(() => {
                resetMessage()
            }, 5000);
            return () => clearTimeout(timer);
        }
    }, [loading, message]);

    useEffect(() => {
        const handleUpdateEvent = () => {
            update(item.identifier)
        }
        window.addEventListener("update-all-subscriptions", handleUpdateEvent)
        return () => {
            window.removeEventListener("update-all-subscriptions", handleUpdateEvent)
        }
    }, [item.identifier])


    if (loading) {
        return <SubscriptionItemSkeleton expanded={expanded === item.identifier} />
    }

    const Title = () => {
        if (message && messageType) {
            let colorClass = '';
            switch (messageType) {
                case 'error':
                    colorClass = 'text-red-500';
                    break;
                case 'success':
                    return <div className="truncate text-sm">{item.name}</div>;
                default:
                    colorClass = 'text-yellow-500';
            }
            return (
                <div
                    className={`text-xs ${colorClass}`}
                    style={{
                        maxWidth: '10rem',
                        overflowX: 'auto',
                        whiteSpace: 'nowrap',
                        WebkitOverflowScrolling: 'touch',
                    }}
                >
                    {message}
                </div>
            );
        }
        return <div className="truncate text-sm">{item.name}</div>;
    }



    return (
        <li key={item.identifier}>
            <div className="list-row items-center">
                <div onClick={handleWebsiteClick}>
                    <Avatar url={item.official_website} danger={usage >= 100} />
                </div>
                <div className="max-w-40 flex flex-col gap-2">
                    <Title />
                    <div className="text-xs flex items-center">
                        <progress
                            className={`progress h-1 ${usage >= 100 ? 'bg-red-400 [&::-webkit-progress-bar]:bg-red-200 [&::-webkit-progress-value]:bg-red-400' : ''}`}
                            value={usage}
                            max="100"
                        />
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
                loading={loading}
                onUpdate={async () => update(item.identifier)}
                identifier={item.identifier}
                visible={expanded === item.identifier}
                remainingDays={remainingDaysText}
                trafficDetails={trafficDetailsText}
            />
        </li>
    )
}