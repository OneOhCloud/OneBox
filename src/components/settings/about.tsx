import { useEffect, useState } from "react";
import { InfoCircleFill, XLg } from "react-bootstrap-icons";
import { useVersion } from "../../hooks/useVersion";
import { aboutText } from "../../page/data";
import { SettingItem } from "./common";
import { CircleStop } from 'lucide-react';

// 关于组件接口定义
interface AboutProps {
    onClose: () => void;
}

// 信息项接口定义
interface InfoItemProps {
    label: string;
    value: string;
}

// 信息项组件
function InfoItem({ label, value }: InfoItemProps) {
    return (
        <div className="flex justify-between py-2 px-3">
            <span className="text-sm text-gray-700">{label}</span>
            <span className="text-sm text-gray-500">{value}</span>
        </div>
    );
}
// 关于组件
function About({ onClose }: AboutProps) {
    const version = useVersion();
    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center pointer-events-none">
            <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-md max-w-md w-full max-h-[100vh] overflow-hidden flex flex-col pointer-events-auto">
                {/* 标题栏 */}
                <div className="flex justify-between items-center px-4 py-3 border-b border-gray-100">
                    <div className="text-lg font-semibold">关于</div>
                    <button
                        onClick={onClose}
                        className="p-1 rounded-full hover:bg-gray-100"
                    >
                        <XLg size={16} className="text-gray-500" />
                    </button>
                </div>

                {/* Logo和应用信息 */}
                <div className="p-6 text-center">
                    
                    <div className="w-20 h-20 bg-gradient-to-br from-[#007AFF] to-[#5856D6] rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-md">
                        <CircleStop size={60} className="text-white" />
                    </div>

                    <h2 className="text-xl font-bold">OneBox</h2>
                    <p className="text-gray-500 text-sm mt-1">版本 {version}</p>
                </div>

                {/* 系统信息 */}
                <div className="px-4 py-2 bg-gray-50">
                    <h3 className="text-sm font-medium text-gray-500 mb-2">系统信息</h3>
                    <div className="bg-white rounded-lg divide-y divide-gray-100">
                        <InfoItem label="操作系统" value="Windows 11" />
                        <InfoItem label="应用架构" value="x64" />
                        <InfoItem label="内核版本" value="v1.11.5" />
                    </div>
                </div>

                {/* 版权信息 */}
                <div className="flex-1 overflow-auto px-4 py-3">
                    <h3 className="text-sm font-medium text-gray-500 mb-2">版权信息</h3>
                    <pre className="text-xs text-gray-600 whitespace-pre-wrap bg-gray-50 p-3 rounded-lg">
                        {aboutText}
                    </pre>
                </div>

                {/* 底部按钮 */}
                <div className="p-4 border-t border-gray-100">
                    <button
                        onClick={onClose}
                        className="w-full py-2 bg-[#007AFF] text-white rounded-lg font-medium"
                    >
                        关闭
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function AboutItem() {
    const [showAbout, setShowAbout] = useState(false);
    // 当模态框打开时阻止背景滚动
    useEffect(() => {
        if (showAbout) {
            document.body.classList.add('overflow-hidden');
        } else {
            document.body.classList.remove('overflow-hidden');
        }

        // 清理函数
        return () => {
            document.body.classList.remove('overflow-hidden');
        };
    }, [showAbout]);

    return (
        <div>
            {showAbout && <About onClose={() => setShowAbout(false)} />}

            <SettingItem
                icon={<InfoCircleFill className="text-[#007AFF]" size={22} />}
                title="关于"
                onPress={() => setShowAbout(true)}
            />
        </div>
    )
}