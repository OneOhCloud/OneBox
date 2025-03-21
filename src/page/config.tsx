import { Plus, CaretDownFill, Trash, ArrowClockwise, CaretUpFill } from "react-bootstrap-icons"
import { motion } from "framer-motion"
import { useState } from "react"
type AvatarProps = {
    url: string
}

export function Avatar(props: AvatarProps) {
    return (
        <div className="size-10 rounded-full  shadow-lg ">
            <img
                loading="lazy"
                src="https://next.n2ray.dev/images/favicon.ico"
            />
        </div>
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
                        {
                            expanded === index && (
                                <div className="flex flex-col gap-2 px-6 py-4 bg-gray-100">

                                    <div className="flex items-center  justify-between">
                                        <div className="flex gap-2">
                                            <span className="text-xs text-gray-400">流量</span>
                                            <span className="text-xs text-blue-500">0.2/10GB</span>
                                        </div>


                                        <div className="flex gap-2 items-center justify-end">
                                            <button className="btn btn-xs btn-ghost btn-circle  border-0  transition-colors">
                                                <ArrowClockwise className="size-[0.8rem] text-gray-400" />
                                            </button>

                                            <button className="btn btn-xs btn-ghost btn-circle  border-0  transition-colors">
                                                <Trash className="size-[0.8rem] text-gray-400" />
                                            </button>

                                        </div>

                                        <div className="flex gap-2">
                                            <span className="text-xs text-gray-400">剩余</span>
                                            <span className="text-xs text-blue-500">3天</span>
                                        </div>
                                    </div>


                                </div>
                            )
                        }



                    </li>
                ))}
            </ul>
        </div>
    </>
}