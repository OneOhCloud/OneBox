import { motion } from "framer-motion";
import { useState } from "react";

type AvatarProps = {
    url: string
}

export default function Avatar(props: AvatarProps) {
    const { url } = props
    const [isLoaded, setIsLoaded] = useState(false);
    const [isHover, setIsHover] = useState(false);
    


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
                    src={url}
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