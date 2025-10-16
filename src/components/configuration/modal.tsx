import { motion } from "framer-motion";
import { useState } from "react";
import { Plus } from "react-bootstrap-icons";
import { mutate } from "swr";
import { z } from "zod";
import { addSubscription } from "../../action/db";
import { GET_SUBSCRIPTIONS_LIST_SWR_KEY } from "../../types/definition";
import { t } from "../../utils/helper";

// 定义验证模式
const subscriptionSchema = z.object({
    name: z.string().optional(),
    url: z.url(t("please_input_valid_url")).min(1, t("url_cannot_empty"))
});

type ValidationErrors = {
    name?: string;
    url?: string;
};

export function AddSubConfigurationModal() {
    const [isOpen, setIsOpen] = useState(false);
    const [isHovering, setIsHovering] = useState(false);
    const [name, setName] = useState<string>("")
    const [url, setUrl] = useState<string>("")
    const [errors, setErrors] = useState<ValidationErrors>({});

    const handleItemClick = () => {
        setName('')
        setUrl('')
        setErrors({})
        setIsOpen(true)
    }

    const handleClose = () => {
        setIsOpen(false)
    }

    const validateForm = () => {
        try {
            subscriptionSchema.parse({ name, url });
            setErrors({});
            return true;
        } catch (error) {
            if (error instanceof z.ZodError) {
                const newErrors: ValidationErrors = {};
                error.issues.forEach(err => {
                    const path = err.path[0] as keyof ValidationErrors;
                    newErrors[path] = err.message;
                });
                setErrors(newErrors);
            }
            return false;
        }
    };

    const handleAdd = async () => {
        if (validateForm()) {
            handleClose();
            await addSubscription(url, name);
            mutate(GET_SUBSCRIPTIONS_LIST_SWR_KEY);
        }
    }

    return (
        <>
            <button
                className="p-1 rounded-full hover:bg-gray-100 transition-colors border-0 bg-transparent cursor-pointer"
                onMouseEnter={() => setIsHovering(true)}
                onMouseLeave={() => setIsHovering(false)}
                onClick={() => handleItemClick()}
            >
                <motion.div
                    animate={{ rotate: isHovering ? 90 : 0 }}
                    transition={{ duration: 0.3, ease: "easeInOut" }}
                >
                    <Plus className="size-6 text-blue-600" />
                </motion.div>
            </button>

            {isOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
                    {/* 背景遮罩 */}
                    <div
                        className="absolute inset-0 bg-gray-400/60"
                        onClick={handleClose}
                    />

                    {/* 模态框内容 */}
                    <div className="relative bg-white rounded-lg p-3 w-80 max-w-full">
                        <h3 className="font-medium text-xs text-gray-700 mb-4">
                            {t("add_subscription")}
                        </h3>

                        <div className="flex flex-col gap-6">
                            <div>
                                <input
                                    className={`w-full px-2 py-1 text-xs rounded border ${errors.name
                                        ? 'border-red-400 focus:border-red-500 focus:ring-1 focus:ring-red-500'
                                        : 'border-gray-300 focus:border-gray-400 focus:ring-1 focus:ring-gray-400'
                                        } outline-none transition-colors`}
                                    type="text"
                                    placeholder={t("name_placeholder_1")}
                                    value={name}
                                    onChange={(e) => {
                                        setName(e.target.value)
                                        if (errors.name) validateForm();
                                    }}
                                />
                                {errors.name && (
                                    <p className="text-red-500 text-xs mt-1">{errors.name}</p>
                                )}
                            </div>

                            <div>
                                <input
                                    className={`w-full px-2 py-1 text-xs rounded border ${errors.url
                                        ? 'border-red-400 focus:border-red-500 focus:ring-1 focus:ring-red-500'
                                        : 'border-gray-300 focus:border-gray-400 focus:ring-1 focus:ring-gray-400'
                                        } outline-none transition-colors`}
                                    type="text"
                                    placeholder={t("name_placeholder_2")}
                                    value={url}
                                    onChange={(e) => {
                                        setUrl(e.target.value)
                                        if (errors.url) validateForm();
                                    }}
                                />
                                {errors.url && (
                                    <p className="text-red-500 text-xs mt-1">{errors.url}</p>
                                )}
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 mt-6">
                            <button
                                className="px-3 py-1 text-xs rounded bg-transparent hover:bg-gray-100 text-gray-600 transition-colors"
                                onClick={handleClose}
                            >
                                {t("close")}
                            </button>
                            <button
                                className="px-3 py-1 text-xs rounded bg-gray-600 hover:bg-gray-700 text-white transition-colors"
                                onClick={handleAdd}
                            >
                                {t("add")}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    )
}