import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import {
    CheckCircleFill,
    CloudArrowDownFill,
    ExclamationTriangleFill,
    InfoCircleFill,
    Plus,
    XCircleFill,
} from "react-bootstrap-icons";
import {
    MessageType,
    ValidationErrors,
    useModalState,
} from "../../action/modal-state-hook";
import { t } from "../../utils/helper";
import { IOSTextField } from "../common/ios-text-field";

// ---- Form step ---------------------------------------------------------

interface FormStepProps {
    name: string;
    url: string;
    errors: ValidationErrors;
    onNameChange: (value: string) => void;
    onUrlChange: (value: string) => void;
    onClose: () => void;
    onAdd: () => void;
}

const FormStep: React.FC<FormStepProps> = ({
    name,
    url,
    errors,
    onNameChange,
    onUrlChange,
    onClose,
    onAdd,
}) => (
    <>
        <h3
            className="text-[16px] font-semibold text-center pt-5 pb-3.5 px-5 tracking-[-0.01em]"
            style={{ color: "var(--onebox-label)" }}
        >
            {t("add_subscription")}
        </h3>
        <div className="px-4 pb-4 space-y-2.5">
            <IOSTextField
                placeholder={t("name_placeholder_1")}
                value={name}
                onChange={onNameChange}
                error={errors.name}
            />
            <IOSTextField
                placeholder={t("name_placeholder_2")}
                value={url}
                onChange={onUrlChange}
                error={errors.url}
            />
        </div>
        <div
            className="grid grid-cols-2"
            style={{ borderTop: "0.5px solid var(--onebox-separator)" }}
        >
            <button
                className="h-11 text-[14px] transition-colors active:bg-[rgba(60,60,67,0.05)]"
                style={{ color: "var(--onebox-blue)" }}
                onClick={onClose}
            >
                {t("close")}
            </button>
            <button
                className="h-11 text-[14px] font-semibold transition-colors active:bg-[rgba(0,122,255,0.08)]"
                style={{
                    color: "var(--onebox-blue)",
                    borderLeft: "0.5px solid var(--onebox-separator)",
                }}
                onClick={onAdd}
            >
                {t("add")}
            </button>
        </div>
    </>
);

// ---- Loading step ------------------------------------------------------

const LoadingStep: React.FC = () => (
    <div className="flex flex-col items-center justify-center py-8 px-5">
        <div
            className="size-11 rounded-[12px] flex items-center justify-center mb-3"
            style={{ background: "rgba(0, 122, 255, 0.1)" }}
        >
            <CloudArrowDownFill
                size={22}
                style={{ color: "var(--onebox-blue)" }}
            />
        </div>
        <div
            className="text-[14px] font-medium tracking-[-0.005em]"
            style={{ color: "var(--onebox-label)" }}
        >
            {t("adding_subscription")}
        </div>
    </div>
);

// ---- Result step -------------------------------------------------------

interface ResultStepProps {
    message: string;
    messageType: MessageType;
    onClose: () => void;
}

const ResultStep: React.FC<ResultStepProps> = ({
    message,
    messageType,
    onClose,
}) => {
    const config = (() => {
        switch (messageType) {
            case "success":
                return {
                    Icon: CheckCircleFill,
                    color: "#34C759",
                    bg: "rgba(52, 199, 89, 0.12)",
                };
            case "error":
                return {
                    Icon: XCircleFill,
                    color: "#FF3B30",
                    bg: "rgba(255, 59, 48, 0.1)",
                };
            case "warning":
                return {
                    Icon: ExclamationTriangleFill,
                    color: "#FF9500",
                    bg: "rgba(255, 149, 0, 0.1)",
                };
            default:
                return {
                    Icon: InfoCircleFill,
                    color: "var(--onebox-blue)",
                    bg: "rgba(0, 122, 255, 0.1)",
                };
        }
    })();
    const { Icon, color, bg } = config;

    return (
        <>
            <div className="flex flex-col items-center py-6 px-5">
                <div
                    className="size-11 rounded-[12px] flex items-center justify-center mb-3"
                    style={{ background: bg }}
                >
                    <Icon size={22} style={{ color }} />
                </div>
                <p
                    className="text-[14px] font-medium text-center leading-snug tracking-[-0.005em]"
                    style={{ color: "var(--onebox-label)" }}
                >
                    {message}
                </p>
            </div>
            <button
                className="w-full h-11 text-[14px] font-semibold transition-colors active:bg-[rgba(0,122,255,0.08)]"
                style={{
                    color: "var(--onebox-blue)",
                    borderTop: "0.5px solid var(--onebox-separator)",
                }}
                onClick={onClose}
            >
                {t("close")}
            </button>
        </>
    );
};

// ---- Trigger + dialog --------------------------------------------------

/**
 * Hook that returns an `openModal` callback and a ready-to-render
 * `ModalElement`. Configuration page mounts the ModalElement at its root
 * so the modal persists across the EmptyState → list transition that
 * happens when submit succeeds (previously the modal was unmounted
 * mid-flow and the user never saw the success result step).
 */
export function useSubscriptionModalController() {
    const {
        open,
        step,
        name,
        url,
        errors,
        message,
        messageType,
        openModal,
        closeModal,
        onNameChange,
        onUrlChange,
        submit,
    } = useModalState();

    const ModalElement = (
        <AnimatePresence>
            {open && (
                <motion.div
                    className="fixed inset-0 z-50 flex items-center justify-center px-4"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18 }}
                >
                    <div
                        className="absolute inset-0"
                        style={{
                            background: "rgba(15, 23, 42, 0.38)",
                            backdropFilter: "blur(6px)",
                            WebkitBackdropFilter: "blur(6px)",
                        }}
                        onClick={closeModal}
                    />
                    <motion.div
                        className="relative w-full max-w-[290px] bg-white rounded-[14px] overflow-hidden"
                        style={{
                            boxShadow:
                                "0 22px 48px -12px rgba(15, 23, 42, 0.3), 0 4px 14px rgba(15, 23, 42, 0.08)",
                        }}
                        initial={{ scale: 0.92, y: 8 }}
                        animate={{ scale: 1, y: 0 }}
                        exit={{ scale: 0.94, y: 4 }}
                        transition={{
                            duration: 0.22,
                            ease: [0.32, 0.72, 0, 1],
                        }}
                    >
                        {step === "form" && (
                            <FormStep
                                name={name}
                                url={url}
                                errors={errors}
                                onNameChange={onNameChange}
                                onUrlChange={onUrlChange}
                                onClose={closeModal}
                                onAdd={submit}
                            />
                        )}
                        {step === "loading" && <LoadingStep />}
                        {step === "result" && (
                            <ResultStep
                                message={message}
                                messageType={messageType}
                                onClose={closeModal}
                            />
                        )}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );

    return { openModal: () => openModal(), ModalElement };
}

/**
 * Plus-icon trigger button — used as the Configuration header action.
 * Stateless; the parent owns the modal controller and passes `onOpen`.
 */
export function AddSubscriptionTriggerButton({
    onOpen,
}: {
    onOpen: () => void;
}) {
    const [isHovering, setIsHovering] = useState(false);
    return (
        <button
            type="button"
            className="p-1.5 rounded-full transition-colors active:bg-[rgba(0,122,255,0.08)]"
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
            onClick={onOpen}
            aria-label={t("add_subscription")}
        >
            <motion.div
                animate={{ rotate: isHovering ? 90 : 0 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
            >
                <Plus
                    className="size-5"
                    style={{ color: "var(--onebox-blue)" }}
                />
            </motion.div>
        </button>
    );
}
