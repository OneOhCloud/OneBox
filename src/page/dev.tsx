import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";

export default function Page() {

    const [identifier, setIdentifier] = useState<{
        username: string;
        password: string;
    }>({
        username: '',
        password: '',
    });


    const handleSubmit = async () => {
        // 这里可以添加处理提交的逻辑

        invoke("is_privileged", {
            username: identifier.username,
            password: identifier.password,
        }).then((res) => {
            console.log(res);
        }).catch((err) => {
            console.error(err);
        })
        console.log(identifier);
    };

    return (
        <div className="flex flex-col items-center justify-center h-screen">
            <h1 className="text-2xl font-bold mb-4">开发者工具</h1>
            <div className="mb-4">
                <label className="block mb-2">用户名:</label>
                <input
                    type="text"
                    value={identifier.username}
                    onChange={(e) => setIdentifier({ ...identifier, username: e.target.value })}
                    className="border border-gray-300 rounded px-3 py-2"
                />
            </div>
            <div className="mb-4">
                <label className="block mb-2">密码:</label>
                <input
                    type="password"
                    value={identifier.password}
                    onChange={(e) => setIdentifier({ ...identifier, password: e.target.value })}
                    className="border border-gray-300 rounded px-3 py-2"
                />
            </div>
            <button
                onClick={() => handleSubmit()}
                className="bg-blue-500 text-white rounded px-4 py-2"
            >
                提交
            </button>
        </div>
    );



}