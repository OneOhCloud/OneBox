import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { t } from "../../utils/helper";

interface AuthDialogProps {
    open: boolean;
    onClose: () => void;
    onAuthSuccess: () => void;
}

export default function AuthDialog({ open, onClose, onAuthSuccess }: AuthDialogProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [isError, setIsError] = useState(false);
    const [password, setPassword] = useState("");
    const modalRef = useRef<HTMLDialogElement>(null);

    // 初始化和清理
    useEffect(() => {
        if (open) {
            setPassword("");
            setIsError(false);
            modalRef.current?.showModal();

        }

        return () => modalRef.current?.close();
    }, [open]);

    // 验证处理
    const handleVerify = async () => {

        setIsLoading(true);
        setIsError(false);

        try {
            const isPrivileged = await invoke<boolean>("is_privileged", { password: password });

            if (isPrivileged) {
                await invoke("save_privilege_password_to_keyring", { password });
                onAuthSuccess();
                modalRef.current?.close();
            } else {
                setIsError(true);
            }
        } catch (error) {
            console.error("验证错误:", error);
            setIsError(true);
        } finally {
            setIsLoading(false);
        }
    };

    // 关闭处理
    const handleClose = () => {
        setPassword("");
        setIsError(false);
        onClose();
        modalRef.current?.close();
    };

    return (
        <dialog ref={modalRef} className="modal">
            <div className="modal-box max-w-sm p-6">
                <h3 className="text-lg font-medium mb-4">{t("authentication")}</h3>

                <p className="text-xs text-gray-500 mb-6">
                    {t("auth_dialog_description")}
                </p>

                <form onSubmit={e => { e.preventDefault(); handleVerify(); }} className="space-y-4">
                    <div className="form-control">
                        <input
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            className={`input input-bordered w-full ${isError ? "input-error" : ""}`}
                            placeholder={t("boot_password")}
                            autoFocus
                        />

                        {isError && (
                            <p className="mt-2 text-sm text-error">{t("auth_failed")}</p>
                        )}
                    </div>

                    <div className="flex justify-end gap-2 mt-6">
                        <button
                            type="button"
                            onClick={handleClose}
                            className="btn btn-sm btn-ghost"
                        >
                            {t("close")}
                        </button>

                        <button
                            type="submit"
                            className="btn btn-sm btn-primary"
                            disabled={isLoading || !password}
                        >
                            {isLoading ? (
                                <span className="loading loading-spinner loading-xs"></span>
                            ) : t("confirm")}
                        </button>
                    </div>
                </form>
            </div>

            <div className="modal-backdrop  bg-opacity-30" onClick={handleClose}></div>
        </dialog>
    );
}