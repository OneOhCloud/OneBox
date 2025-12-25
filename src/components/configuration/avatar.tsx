import { motion } from "framer-motion";
import { useState } from "react";
import { ExclamationCircleFill, GlobeAsiaAustralia } from "react-bootstrap-icons";

type AvatarProps = {
    url: string
    danger: boolean
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
    },
    danger: {
        boxShadow: "0px 0px 0px 2px rgba(239, 68, 68, 0.8)",
        transition: { duration: 0.2 }
    },
    dangerNormal: {
        boxShadow: "0px 0px 0px rgba(239, 68, 68, 0)"
    }
};

export default function Avatar(props: AvatarProps) {
    const { url, danger } = props;
    const [isHover, setIsHover] = useState(false);

    const isHttpsUrl = url && url.startsWith('https');
    const avatarUrl = `${url}/favicon.ico`;
    const showUrlIcon = isHover && isHttpsUrl && !danger;

    // 红色视觉层级分明的背景色
    const bgClass = danger
        ? "bg-red-100" // 红色浅底
        : "bg-gray-200";

    // 动画状态
    let initialVariant = danger ? "dangerNormal" : "normal";
    let animateVariant = danger
        ? (isHover ? "danger" : "dangerNormal")
        : (isHover ? "hover" : "normal");

    return (
        <motion.div
            className="size-10 rounded-full overflow-hidden relative"
            variants={containerVariants}
            initial={initialVariant}
            animate={animateVariant}
            onHoverStart={() => setIsHover(true)}
            onHoverEnd={() => setIsHover(false)}
            whileTap={{ scale: 0.95 }}
        >
            <div className={`w-full h-full flex items-center justify-center cursor-pointer ${bgClass}`}>
                <div className="absolute inset-0">
                    {!danger && (
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
                    )}
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
                        {danger ? (
                            <ExclamationCircleFill className="text-red-500" size={22} />
                        ) : (
                            <GlobeAsiaAustralia className="text-gray-400" size={20} />
                        )}
                    </motion.div>
                </div>
            </div>
        </motion.div>
    );
}