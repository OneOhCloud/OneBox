import { ArrowClockwise, CaretDownFill, CaretUpFill, Trash } from "react-bootstrap-icons"
import Avatar from "./avatar"
import { AnimatePresence, motion } from "framer-motion"
import { itemVariants, contentVariants } from "../../page/variants"
import { Subscription } from "../../hooks/definition"
import bytes from "bytes"

type SubscriptionItemProps = {
    item: Subscription
    expanded: string
    setExpanded: (id: string) => void
}

type ItemProps = {
    index: string
    visible: boolean
    remainingDays: string
    trafficDetails: string
}

function Item(props: ItemProps) {
    const { index, visible, remainingDays, trafficDetails } = props

    return (
        <AnimatePresence initial={false}>
            {visible && (
                <motion.div
                    variants={itemVariants}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    key={index}
                    className="overflow-hidden"
                    style={{
                        willChange: "transform, opacity, height, clip-path",
                        backfaceVisibility: "hidden"
                    }}
                >
                    <motion.div
                        variants={contentVariants}
                        className="flex flex-col gap-2 px-6 py-4 bg-gray-100 rounded-b"
                    >
                        <div className="flex items-center justify-between">
                            <div className="flex gap-2">
                                <span className="text-xs text-gray-400">流量</span>
                                <span className="text-xs text-blue-500">{trafficDetails}</span>
                            </div>

                            <div className="flex gap-2 items-center justify-end">
                                <button className="btn btn-xs btn-ghost btn-circle border-0 transition-colors hover:bg-blue-50">
                                    <ArrowClockwise className="size-[0.8rem] text-gray-400" />
                                </button>

                                <button className="btn btn-xs btn-ghost btn-circle border-0 transition-colors hover:bg-red-50">
                                    <Trash className="size-[0.8rem] text-gray-400" />
                                </button>
                            </div>

                            <div className="flex gap-2">
                                <span className="text-xs text-gray-400">剩余</span>
                                <span className="text-xs text-blue-500">{remainingDays}</span>
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}

export function SubscriptionItem(
    props: SubscriptionItemProps
) {

    const { item, expanded, setExpanded } = props
    const useage = Math.floor((item.used_traffic / item.total_traffic) * 100)

    const remainingDays = Math.floor((item.expire_time - item.last_update_time) / (1000 * 60 * 60 * 24))
    const trafficDetailsText = `${bytes(item.used_traffic)}/${bytes(item.total_traffic)}`
    const remainingDaysText = `${remainingDays} 天`


    return (
        <li key={item.identifier}>

            <div className="list-row  items-center">
                <div>
                    <Avatar url={item.official_website + "/favicon.ico"} />
                </div>
                <div className="max-w-[160px] flex flex-col gap-2 ">
                    <div className="truncate text-sm">{item.name}</div>
                    <div className=" text-xs flex items-center ">
                        <progress className="progress h-1" value={useage} max="100"></progress>

                    </div>
                </div>
                {
                    expanded === item.identifier ? (
                        <button className="btn btn-ghost btn-xs btn-circle  border-0  transition-colors" onClick={() => setExpanded('')}>
                            <CaretUpFill className="size-[0.8rem]"></CaretUpFill>
                        </button>
                    ) : (
                        <button className="btn btn-ghost btn-xs btn-circle  border-0  transition-colors" onClick={() => setExpanded(item.identifier)}>
                            <CaretDownFill className="size-[0.8rem]"></CaretDownFill>
                        </button>
                    )
                }

            </div>

            <Item
                index={item.identifier}
                visible={expanded === item.identifier}
                remainingDays={remainingDaysText}
                trafficDetails={trafficDetailsText}

            />



        </li>
    )

}