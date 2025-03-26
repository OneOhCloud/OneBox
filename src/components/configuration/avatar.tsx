import { useState } from "react";
import { GlobeAsiaAustralia } from "react-bootstrap-icons";
import { motion, AnimatePresence } from "framer-motion";

type AvatarProps = {
    url: string
}

export default function Avatar(props: AvatarProps) {
    const { url } = props
    const [isHover, setIsHover] = useState(false);

    const isHttpsUrl = url && url.startsWith('https');
    const avatarUrl = `${url}/favicon.ico`
    console.log('avatarUrl', avatarUrl)
    const showUrlIcon = isHover && isHttpsUrl;

    // 图标切换动画效果
    const iconVariants = {
        initial: { opacity: 0, scale: 0.8 },
        animate: {
            opacity: 1,
            scale: 1,
            transition: { duration: 0.2, ease: "easeOut" }
        },
        exit: {
            opacity: 0,
            scale: 0.8,
            transition: { duration: 0.15, ease: "easeIn" }
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
            <div className="w-full h-full bg-gray-200 flex items-center justify-center">
                <AnimatePresence mode="wait">
                    {showUrlIcon ? (
                        <motion.img
                            key="urlIcon"
                            loading="lazy"
                            src={avatarUrl}
                            className="w-full h-full object-cover"
                            alt="Avatar"
                            variants={iconVariants}
                            initial="initial"
                            animate="animate"
                            exit="exit"
                        />
                    ) : (
                        <motion.div
                            key="defaultIcon"
                            className="flex items-center justify-center"
                            variants={iconVariants}
                            initial="initial"
                            animate="animate"
                            exit="exit"
                        >
                            <GlobeAsiaAustralia className="text-gray-400" size={20} />
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </motion.div>
    );
}