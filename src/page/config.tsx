import { Plus, CaretDownFill, Trash, ArrowClockwise, CaretUpFill } from "react-bootstrap-icons"
import { AnimatePresence, motion } from "framer-motion"
import { useState } from "react"
import { contentVariants, itemVariants } from "./variants"
type AvatarProps = {
    url: string
}

export function Avatar(props: AvatarProps) {
    const { url } = props
    
    
    const [isLoaded, setIsLoaded] = useState(false);
    const [isHover, setIsHover] = useState(false);

    console.log("isLoaded", url)
    
    // 图像加载动画
    const imageLoadVariants = {
        hidden: { 
            opacity: 0,
            scale: 0.8,
            rotate: -10
        },
        visible: { 
            opacity: 1,
            scale: 1,
            rotate: 0,
            transition: {
                type: "spring",
                stiffness: 260,
                damping: 20,
                duration: 0.5
            }
        }
    };
    
    // 悬停动画
    const hoverVariants = {
        idle: { 
            scale: 1,
            boxShadow: "0px 4px 8px rgba(0, 0, 0, 0.1)"
        },
        hover: { 
            scale: 1.05,
            boxShadow: "0px 8px 15px rgba(0, 0, 0, 0.15)",
            transition: {
                type: "spring",
                stiffness: 400,
                damping: 15
            }
        }
    };
    
    return (
        <motion.div 
            className="size-10 rounded-full overflow-hidden"
            variants={hoverVariants}
            initial="idle"
            animate={isHover ? "hover" : "idle"}
            onHoverStart={() => setIsHover(true)}
            onHoverEnd={() => setIsHover(false)}
            whileTap={{ scale: 0.95 }}
        >
            <motion.div
                className="w-full h-full bg-gray-200 flex items-center justify-center"
                variants={imageLoadVariants}
                initial="hidden"
                animate={isLoaded ? "visible" : "hidden"}
            >
                <motion.img
                    loading="lazy"
                    src="https://next.n2ray.dev/images/favicon.ico"
                    className="w-full h-full object-cover"
                    onLoad={() => setIsLoaded(true)}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: isLoaded ? 1 : 0 }}
                    transition={{ duration: 0.3 }}
                    style={{
                        filter: isHover ? "brightness(1.1)" : "brightness(1)"
                    }}
                />
            </motion.div>
        </motion.div>
    );
}


type ItemProps = {
    index: number
    visible: boolean
}

export function Item(props: ItemProps) {
    const { index, visible } = props



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
                                <span className="text-xs text-blue-500">0.2/10GB</span>
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
                                <span className="text-xs text-blue-500">3天</span>
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}

export default function Configuration() {
    const [isHovering, setIsHovering] = useState(false);
    const [expanded, setExpanded] = useState(-1)

    

    return <>
        <div className="h-full mb-4 w-full">
            <div className="p-2 flex justify-between items-center">
                <h3 className="text-gray-500  text-sm  font-bold">订阅管理</h3>
                <button
                    className="btn btn-xs btn-ghost btn-circle  border-0  transition-colors"
                    onMouseEnter={() => setIsHovering(true)}
                    onMouseLeave={() => setIsHovering(false)}
                >
                    <motion.div
                        animate={{ rotate: isHovering ? 90 : 0 }}
                        transition={{ duration: 0.3, ease: "easeInOut" }}
                    >
                        <Plus className="size-6 text-blue-600" />
                    </motion.div>
                </button>
            </div>
            <ul className="list bg-base-100 rounded-box m-2  overflow-y-auto max-h-[410px]">
                {Array.from({ length: 50 }, (_, index) => (
                    <li key={index}>

                        <div className="list-row  items-center">
                            <div>
                                <Avatar url="" />
                            </div>
                            <div className="max-w-[160px] flex flex-col gap-2 ">
                                <div className="truncate text-sm">订阅配置 {index + 1}</div>
                                <div className=" text-xs flex items-center ">
                                    <progress className="progress h-1" value={(index + 1) * 2} max="100"></progress>

                                </div>
                            </div>
                            {
                                expanded === index ? (
                                    <button className="btn btn-ghost btn-xs btn-circle  border-0  transition-colors" onClick={() => setExpanded(-1)}>
                                        <CaretUpFill className="size-[0.8rem]"></CaretUpFill>
                                    </button>
                                ) : (
                                    <button className="btn btn-ghost btn-xs btn-circle  border-0  transition-colors" onClick={() => setExpanded(index)}>
                                        <CaretDownFill className="size-[0.8rem]"></CaretDownFill>
                                    </button>
                                )
                            }

                        </div>

                        <Item index={index} visible={expanded === index} />



                    </li>
                ))}
            </ul>
        </div>
    </>
}