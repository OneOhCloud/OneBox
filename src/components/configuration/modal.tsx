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
    url: z.string().url(t("please_input_valid_url")).min(1, t("url_cannot_empty"))
});

type ValidationErrors = {
    name?: string;
    url?: string;
};

export function AddSubConfigurationModal() {
    const modalKey = "addSubConfigurationModal"
    const [isHovering, setIsHovering] = useState(false);
    const [name, setName] = useState<string>("")
    const [url, setUrl] = useState<string>("")
    const [errors, setErrors] = useState<ValidationErrors>({});

    const handleItemClick = () => {
        setName('')
        setUrl('')
        setErrors({})
        // @ts-ignore
        document.getElementById(modalKey).showModal()
    }

    // @ts-ignore
    const handleClose = () => {
        // @ts-ignore
        document.getElementById(modalKey).close()
    }

    const validateForm = () => {
        try {
            subscriptionSchema.parse({ name, url });
            setErrors({});
            return true;
        } catch (error) {
            if (error instanceof z.ZodError) {
                const newErrors: ValidationErrors = {};
                error.errors.forEach(err => {
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
                className="btn btn-xs btn-ghost btn-circle border-0 transition-colors"
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
            <dialog id="addSubConfigurationModal" className="modal z-1">
                <div className="modal-box bg-white">
                    <h3 className="font-bold text-lg">
                        {/* 添加订阅 */
                            t("add_subscription")
                        }
                    </h3>
                    <div className="flex flex-col gap-8 mt-8">
                        <div>
                            <input
                                className={`input input-sm w-full ${errors.name ? 'input-error' : ''}`}
                                type="text" placeholder={
                                    // 名称默认由远程提供，可空
                                    t("name_placeholder_1")
                                }
                                value={name}
                                onChange={(e) => {
                                    setName(e.target.value)
                                    if (errors.name) validateForm();
                                }}
                            />
                            {errors.name && (
                                <p className="text-error text-xs mt-1">{errors.name}</p>
                            )}
                        </div>
                        <div>
                            <input
                                className={`input input-sm w-full ${errors.url ? 'input-error' : ''}`}
                                type="text"
                                placeholder={t("name_placeholder_2")}
                                value={url}
                                onChange={(e) => {
                                    setUrl(e.target.value)
                                    if (errors.url) validateForm();
                                }}
                            />
                            {errors.url && (
                                <p className="text-error text-xs mt-1">{errors.url}</p>
                            )}
                        </div>
                    </div>

                    <div className="modal-action">
                        <form method="dialog" >
                            <button className="btn btn-ghost btn-sm">{t("close")}</button>
                        </form>
                        <button className="btn  btn-sm btn-primary" onClick={handleAdd}>
                            {/* 添加 */
                                t("add")
                            }
                        </button>

                    </div>
                </div>
            </dialog>
        </>
    )
}