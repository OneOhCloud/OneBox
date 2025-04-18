import { invoke } from "@tauri-apps/api/core";
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { Dash, X } from "react-bootstrap-icons";
import { Toaster } from "react-hot-toast";
import { getSingBoxConfigPath } from "../utils/helper";

const appWindow = getCurrentWindow();

async function start() {
    const configPath = await getSingBoxConfigPath();
    await invoke("start", {
        app: appWindow,
        path: configPath
    })
}

async function stop() {
    await invoke("stop")
}

export default function Page() {
    const [isRunning, setIsRunning] = useState<boolean>(false);
    const [logs, setLogs] = useState<string[]>([]);

    // 修改事件监听，将日志保存到状态中
    useEffect(() => {
        const unsubscribe = listen('core_backend', (event) => {
            const payload = event.payload as string;
            if (payload === 'Process terminated') {
                setIsRunning(false); // 进程终止时更新状态
                return;
            }

            // 移除 ANSI 转义序列
            const cleanLog = payload.replace(/\u001b\[\d+m/g, '');
            setLogs(prev => [...prev, cleanLog].slice(-100));
        });

        return () => {
            unsubscribe.then(fn => fn());
        };
    }, []);

    const handleToggle = async () => {
        try {
            if (isRunning) {
                await stop();
            } else {
                await start();
            }
            setIsRunning(!isRunning);
        } catch (error) {
            console.error('Error toggling service:', error);
        }
    };

    const handleClose = async () => {
        await appWindow.hide();
    };

    const handleMinimize = async () => {
        await appWindow.minimize();
    };

    return (
        <main className="bg-gray-50 grid grid-rows-[auto_1fr_auto] h-dvh">
            <Toaster position="top-center" toastOptions={{ duration: 2000 }} containerClassName="mt-[32px]" />

            {/* 标题栏 */}
            <div data-tauri-drag-region
                className="px-4 py-2.5 flex items-center justify-between bg-white/80 backdrop-blur-lg border-b border-gray-200">
                <div className="flex items-center">
                    <div className="mr-3 flex items-center gap-1.5">
                        <div onClick={handleClose}
                            className="size-3 bg-red-500 rounded-full flex items-center justify-center hover:bg-red-600 transition-all cursor-pointer group"
                            title="关闭">
                            <X size={7} className="text-transparent group-hover:text-red-900" />
                        </div>
                        <div onClick={handleMinimize}
                            className="size-3 bg-yellow-400 rounded-full flex items-center justify-center hover:bg-yellow-500 transition-all cursor-pointer group"
                            title="最小化">
                            <Dash size={7} className="text-transparent group-hover:text-yellow-900" />
                        </div>
                        <div className="size-3 bg-green-500 rounded-full flex opacity-50 cursor-default"></div>
                    </div>
                    <span className="ml-2 font-medium text-sm tracking-tight">OneBox</span>
                </div>
            </div>

            {/* 主内容区 */}
            <div className="p-4 flex flex-col gap-4">
                {/* 开关控制 */}
                <div className="flex items-center justify-between p-4 bg-white rounded-lg shadow">
                    <span className="text-sm font-medium">服务状态</span>
                    <label className="swap swap-flip">
                        <input
                            type="checkbox"
                            checked={isRunning}
                            onChange={handleToggle}
                        />
                        <div className="swap-on">
                            <div className="badge badge-success gap-2">
                                运行中
                            </div>
                        </div>
                        <div className="swap-off">
                            <div className="badge badge-error gap-2">
                                已停止
                            </div>
                        </div>
                    </label>
                </div>

                {/* 日志输出区域 */}
                <div className="flex-1 bg-white rounded-lg shadow p-4">
                    <div className="text-sm font-medium mb-2">运行日志</div>
                    <div className="h-[300px] overflow-y-auto bg-gray-50 rounded p-2">
                        {logs.map((log, index) => (
                            <pre key={index} className="text-xs text-gray-600 whitespace-pre-wrap leading-5">
                                {log.replace(/^'|'$/g, '')} {/* 移除首尾的单引号 */}
                            </pre>
                        ))}
                    </div>
                </div>
            </div>
        </main>
    );
}