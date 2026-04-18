import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { Plus } from "react-bootstrap-icons";
import {
    ValidationErrors,
    useModalState,
} from "../../action/modal-state-hook";
import { t } from "../../utils/helper";
import { IOSTextField } from "../common/ios-text-field";
import {
    DeepLinkApplyPhase,
    DeepLinkApplyProgressModal,
} from "../home/deep-link-apply-progress-modal";

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

    const showForm = open && step === "form";
    const showProgress = open && step !== "form";
    const progressPhase: DeepLinkApplyPhase =
        step === "loading"
            ? "import"
            : messageType === "success"
                ? "done"
                : "error";

    const ModalElement = (
        <>
            <AnimatePresence>
                {showForm && (
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
                            <FormStep
                                name={name}
                                url={url}
                                errors={errors}
                                onNameChange={onNameChange}
                                onUrlChange={onUrlChange}
                                onClose={closeModal}
                                onAdd={submit}
                            />
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
            <DeepLinkApplyProgressModal
                visible={showProgress}
                phase={progressPhase}
                errorMessage={
                    progressPhase === "error" && message ? message : undefined
                }
                onClose={closeModal}
                steps={["import"]}
                titleLabels={{
                    running: t("adding_subscription"),
                    error: t("add_subscription_failed"),
                }}
                stepLabels={{
                    import: t("dl_phase_import"),
                    done: t("add_subscription_success"),
                }}
            />
        </>
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
