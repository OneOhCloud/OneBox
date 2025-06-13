// 重新设计的高级展开/收起动画效果
export const itemVariants = {
    hidden: {
        opacity: 0,
        height: 0,
        // 从一个小点开始
        scaleX: 0.05,
        scaleY: 0,
        clipPath: "inset(0% 47.5% 100% 47.5% round 16px)",
        filter: "blur(5px)",
        transformOrigin: "top center",
    },
    visible: {
        opacity: 1,
        height: "auto",
        scaleX: 1,
        scaleY: 1,
        clipPath: "inset(0% 0% 0% 0% round 0px)",
        filter: "blur(0px)",
        transformOrigin: "top center",
        transition: {
            // 使用交错顺序动画，先宽度，后高度
            default: { duration: 0.4 },
            height: {
                type: "spring" as const,
                stiffness: 400,
                damping: 25,
                delay: 0.05
            },
            opacity: {
                duration: 0.2,
                delay: 0.1
            },
            clipPath: {
                duration: 0.4
            },
            scaleX: {
                type: "spring" as const,
                stiffness: 500,
                damping: 30,
                delay: 0
            },
            scaleY: {
                type: "spring" as const,
                stiffness: 400,
                damping: 28,
                delay: 0.05
            },
            filter: {
                duration: 0.2,
                delay: 0.1
            }
        }
    },
    exit: {
        opacity: 0,
        height: 0,
        scaleX: 0.05,
        scaleY: 0,
        clipPath: "inset(0% 47.5% 100% 47.5% round 16px)",
        filter: "blur(5px)",
        transformOrigin: "top center",
        transition: {
            // 收起时动画更快，先变窄，再减小高度
            height: {
                duration: 0.25,
                delay: 0.05
            },
            scaleX: {
                duration: 0.2
            },
            scaleY: {
                duration: 0.2,
                delay: 0.05
            },
            opacity: {
                duration: 0.15
            },
            clipPath: {
                duration: 0.25
            },
            filter: {
                duration: 0.1
            }
        }
    }
}

// 内容的交错动画
export const contentVariants = {
    hidden: {
        opacity: 0,
        y: -10,
        scale: 0.95
    },
    visible: {
        opacity: 1,
        y: 0,
        scale: 1,
        transition: {
            duration: 0.2,
            delay: 0.1
        }
    },
    exit: {
        opacity: 0,
        y: -8,
        scale: 0.95,
        transition: {
            duration: 0.1
        }
    }
}