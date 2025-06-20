import { motion } from "framer-motion";
import { useState } from "react";
import { GlobeAsiaAustralia } from "react-bootstrap-icons";

type AvatarProps = {
    url: string
}


// 图标切换动画效果
const iconVariants = {
    initial: { opacity: 0, scale: 0.8 },
    animate: {
        opacity: 1,
        scale: 1,
        transition: { duration: 0.2 }
    },
    exit: {
        opacity: 0,
        scale: 0.8,
        transition: { duration: 0.15 }
    }
};

// 边框高亮动画效果
const containerVariants = {
    normal: {
        boxShadow: "0px 0px 0px rgba(59, 130, 246, 0)"
    },
    hover: {
        boxShadow: "0px 0px 0px 2px rgba(59, 130, 246, 0.8)",
        transition: { duration: 0.2 }
    }
};

export default function Avatar(props: AvatarProps) {
    const { url } = props
    const [isHover, setIsHover] = useState(false);

    const isHttpsUrl = url && url.startsWith('https');
    const avatarUrl = `${url}/favicon.ico`
    const showUrlIcon = isHover && isHttpsUrl;

    return (
        <motion.div
            className="size-10 rounded-full overflow-hidden relative"
            variants={containerVariants}
            initial="normal"
            animate={isHover ? "hover" : "normal"}
            onHoverStart={() => setIsHover(true)}
            onHoverEnd={() => setIsHover(false)}
            whileTap={{ scale: 0.95 }}
        >
            <div className="w-full h-full bg-gray-200 flex items-center justify-center cursor-pointer ">
                <div className="absolute inset-0">
                    <motion.img
                        key="urlIcon"
                        loading="lazy"
                        src={avatarUrl}
                        className="w-full h-full object-cover"
                        alt="Avatar"
                        initial="initial"
                        animate={showUrlIcon ? "animate" : "exit"}
                        variants={iconVariants}
                        style={{
                            opacity: showUrlIcon ? 1 : 0,
                            pointerEvents: showUrlIcon ? 'auto' : 'none',
                        }}
                    />
                    <motion.div
                        key="defaultIcon"
                        className="absolute inset-0 flex items-center justify-center"
                        initial="initial"
                        animate={showUrlIcon ? "exit" : "animate"}
                        variants={iconVariants}
                        style={{
                            opacity: showUrlIcon ? 0 : 1,
                            pointerEvents: showUrlIcon ? 'none' : 'auto',
                        }}
                    >
                        <GlobeAsiaAustralia className="text-gray-400" size={20} />
                    </motion.div>
                </div>
            </div>
        </motion.div>
    );
}