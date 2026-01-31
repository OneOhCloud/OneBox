import { motion } from "framer-motion";
import { useState } from "react";
import { CheckCircle, CloudArrowDown, ExclamationTriangle, InfoCircle, Plus, XCircle } from "react-bootstrap-icons";
import { mutate } from "swr";
import { z } from "zod";
import { useAddSubscription } from "../../action/subscription-hooks";
import { GET_SUBSCRIPTIONS_LIST_SWR_KEY } from "../../types/definition";
import { t } from "../../utils/helper";

type Step = 'form' | 'loading' | 'result';

// 定义验证模式
const subscriptionSchema = z.object({
    name: z.string().optional(),
    url: z.url(t("please_input_valid_url")).min(1, t("url_cannot_empty"))
});

type ValidationErrors = {
    name?: string;
    url?: string;
};

interface FormStepProps {
    name: string;
    url: string;
    errors: ValidationErrors;
    onNameChange: (value: string) => void;
    onUrlChange: (value: string) => void;
    onClose: () => void;
    onAdd: () => void;
}

interface LoadingStepProps {
    loading: boolean;
}

type MessageType = 'success' | 'error' | 'warning' | undefined;

interface ResultStepProps {
    message: string;
    messageType: MessageType;
    onClose: () => void;
}

const FormStep: React.FC<FormStepProps> = ({ name, url, errors, onNameChange, onUrlChange, onClose, onAdd }) => (
    <>
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
                    onChange={(e) => onNameChange(e.target.value)}
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
                    onChange={(e) => onUrlChange(e.target.value)}
                />
                {errors.url && (
                    <p className="text-red-500 text-xs mt-1">{errors.url}</p>
                )}
            </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
            <button
                className="px-3 py-1 text-xs rounded bg-transparent hover:bg-gray-100 text-gray-600 transition-colors"
                onClick={onClose}
            >
                {t("close")}
            </button>
            <button
                className="px-3 py-1 text-xs rounded bg-gray-600 hover:bg-gray-700 text-white transition-colors"
                onClick={onAdd}
            >
                {t("add")}
            </button>
        </div>
    </>
);

const LoadingStep: React.FC<LoadingStepProps> = () => (
    <div className="flex flex-col items-center justify-center min-h-30 py-8">
        <div className="relative w-16 h-16 flex items-center justify-center">
            <CloudArrowDown className="text-gray-400 w-16 h-16" />
            <motion.div
                className="absolute left-0 w-full h-1 pointer-events-none"
                style={{ background: 'linear-gradient(to bottom, rgba(156,163,175,0.0), rgba(156,163,175,0.3), rgba(156,163,175,0.0))', borderRadius: '8px' }}
                initial={{ top: 0 }}
                animate={{ top: [0, 48] }}
                transition={{ duration: 1.2, repeat: Infinity, repeatType: "loop", ease: "linear" }}
            />
        </div>
        <span className="text-base font-medium tracking-wide animate-pulse">
            {t('adding_subscription')}
        </span>
    </div>
);

const ResultStep: React.FC<ResultStepProps> = ({ message, messageType, onClose }) => {
    let IconComponent = InfoCircle;
    // 统一暗灰色
    const iconClass = "w-16 h-16 text-gray-500";
    let textClass = "text-gray-700";
    switch (messageType) {
        case "success":
            IconComponent = CheckCircle;
            break;
        case "error":
            IconComponent = XCircle;
            break;
        case "warning":
            IconComponent = ExclamationTriangle;
            break;
        default:
            IconComponent = InfoCircle;
    }
    return (
        <div className="flex flex-col items-center justify-center min-h-30 py-2">
            <IconComponent className={iconClass} />

            <div className={`mt-4 text-sm font-medium tracking-wide ${textClass}`}>
                {message}
            </div>

            <button
                className="mt-2 px-4 py-1.5 text-sm rounded bg-gray-600 hover:bg-gray-700 text-white transition-colors shadow"
                onClick={onClose}
            >
                {t('close')}
            </button>
        </div>
    );
};


export function AddSubConfigurationModal() {
    const [showModal, setShowModal] = useState<boolean>(false);
    const [isHovering, setIsHovering] = useState<boolean>(false);
    const [name, setName] = useState<string>("");
    const [url, setUrl] = useState<string>("");
    const [errors, setErrors] = useState<ValidationErrors>({});
    const [step, setStep] = useState<Step>('form');

    const { add, resetMessage, loading, message, messageType } = useAddSubscription();
    const handleItemClick = (): void => {
        setName("");
        setUrl("");
        setErrors({});
        setStep('form');
        resetMessage();
        setShowModal(true);
    };


    const handleClose = (): void => {
        setShowModal(false);
        setStep('form');
        resetMessage();
    };

    const validateForm = (): boolean => {
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

    const handleAdd = async (): Promise<void> => {
        if (validateForm()) {
            setStep('loading');
            await add(url, name);
            mutate(GET_SUBSCRIPTIONS_LIST_SWR_KEY);
            setStep('result');
        }
    };

    const handleNameChange = (value: string): void => {
        setName(value);
        if (errors.name) validateForm();
    };

    const handleUrlChange = (value: string): void => {
        setUrl(value);
        if (errors.url) validateForm();
    };

    return (
        <>
            <button
                className="p-1 rounded-full hover:bg-gray-100 transition-colors border-0 bg-transparent cursor-pointer"
                onMouseEnter={() => setIsHovering(true)}
                onMouseLeave={() => setIsHovering(false)}
                onClick={handleItemClick}
            >
                <motion.div
                    animate={{ rotate: isHovering ? 90 : 0 }}
                    transition={{ duration: 0.3, ease: "easeInOut" }}
                >
                    <Plus className="size-6 text-blue-600" />
                </motion.div>
            </button>

            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
                    {/* 背景遮罩 */}
                    <div
                        className="absolute inset-0 bg-gray-400/60"
                        onClick={handleClose}
                    />

                    {/* 模态框内容 */}
                    <div className="relative bg-white rounded-lg p-3 w-80 max-w-full min-h-45 flex flex-col justify-center">
                        {step === 'form' && (
                            <FormStep
                                name={name}
                                url={url}
                                errors={errors}
                                onNameChange={handleNameChange}
                                onUrlChange={handleUrlChange}
                                onClose={handleClose}
                                onAdd={handleAdd}
                            />
                        )}
                        {step === 'loading' && (
                            <LoadingStep loading={loading} />
                        )}
                        {step === 'result' && (
                            <ResultStep
                                message={message}
                                messageType={messageType}
                                onClose={handleClose}
                            />
                        )}
                    </div>
                </div>
            )}
        </>
    );
}