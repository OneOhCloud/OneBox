import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { setStoreValue } from "../../single/store";
import { PRIVILEGED_PASSWORD_STORE_KEY } from "../../types/definition";

interface AuthDialogProps {
    open: boolean; // 控制对话框的打开状态
    onClose: () => void; // 关闭对话框的回调函数
    onAuthSuccess: () => void; // 回调函数，通知父组件授权成功
}

export default function AuthDialog(props: AuthDialogProps) {
    const { open, onClose, onAuthSuccess } = props;
    const [status, setStatus] = useState<string>("pending");
    const [identifier, setIdentifier] = useState<{ username: string; password: string }>({
        username: "",
        password: "",
    });

    const modalRef = useRef<HTMLDialogElement>(null);

    const verify = async (username: string, password: string) => {
        setStatus("loading");
        try {
            const result = await invoke<boolean>("is_privileged", {
                username,
                password,
            });
            if (result) {
                setStoreValue(PRIVILEGED_PASSWORD_STORE_KEY, password);
                setStatus("success");
                onAuthSuccess();
                modalRef.current?.close();
            } else {
                modalRef.current?.showModal();

                setStatus("failed");
            }
        } catch (error) {
            console.error("Error invoking is_privileged:", error);
            setStatus("failed");
        }
    };

    const handleSubmit = async () => {
        await verify(identifier.username, identifier.password);
    };

    const getStatus = () => {
        if (status === "loading") {
            return <span className="loading loading-infinity loading-sm"></span>;
        } else if (status === "success") {
            return "授权成功";
        } else if (status === "failed") {
            return "授权失败";
        }
    };

    useEffect(() => {
        // 初始化获取用户名并根据状态打开对话框
        setStatus("pending");
        invoke<string>("get_current_username")
            .then(async (username) => {
                setIdentifier((prev) => ({ ...prev, username }));
                if (open) {
                    modalRef.current?.showModal();

                }
            })
            .catch((err) => {
                console.error(err);
            });
    }, [open]);

    return (
        <dialog ref={modalRef} id="auth_modal" className="modal">
            <div className="modal-box">
                <div className="modal-header mb-4">
                    当前状态: {getStatus()}
                </div>
                <div className="text-xs text-gray-700 mb-2">
                    授权后才能启动 tun 模式
                </div>
                <div>
                    <div className="mb-4">
                        <label className="block mb-2">开机密码</label>
                        <input
                            type="password"
                            value={identifier.password}
                            onChange={(e) =>
                                setIdentifier({ ...identifier, password: e.target.value })
                            }
                            className="input input-sm"
                        />
                    </div>
                </div>
                <div className="modal-action">
                    <button
                        onClick={() => {
                            onClose();
                            modalRef.current?.close();
                        }}
                        className="btn btn-sm"
                    >
                        取消
                    </button>
                    <button
                        onClick={handleSubmit}
                        className="btn btn-sm btn-primary"
                        disabled={status === "loading"}
                    >
                        {status === "loading" ? (<span className="loading loading-infinity loading-sm"></span>) : "提交"}
                    </button>
                </div>
            </div>
        </dialog>
    );
}