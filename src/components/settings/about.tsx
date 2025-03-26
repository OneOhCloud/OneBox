import { openUrl } from '@tauri-apps/plugin-opener';
import { useEffect, useState } from "react";
import { Github, Globe, InfoCircleFill, XLg } from "react-bootstrap-icons";
import { GITHUB_URL, OFFICIAL_WEBSITE, OsInfo, SING_BOX_VERSION } from "../../types/definition";
import { formatOsInfo, getOsInfo, getSingBoxUserAgent } from "../../utils/helper";
import { aboutText } from "../../page/data";
import { SettingItem } from "./common";
import toast from 'react-hot-toast';

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
    const [osInfo, setOsInfo] = useState<OsInfo>({
        appVersion: "",
        osArch: "x86",
        osType: "windows",
        osVersion: "",
        osLocale: "",
    });
    const [ua, setUa] = useState<string>("");

    useEffect(() => {
        getOsInfo().then((info) => {
            setOsInfo(info)
        }
        ).catch((e) => {
            console.error(e)
        })

        getSingBoxUserAgent().then((ua) => {
            setUa(ua)
        }
        ).catch((e) => {
            console.error(e)
        })


    }, [])

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

                {/* 应用信息 */}
                <div className="px-6 pt-6 pb-4 text-center">


                    <h2 className="text-xl font-bold">OneBox</h2>
                    <p className="text-gray-500 text-xs mt-1">版本 {osInfo.appVersion}</p>
                </div>

                {/* 合并系统信息和版权信息到一个可滚动区域 */}
                <div className="flex-1 overflow-auto px-4 py-3 bg-gray-50">
                    {/* 系统信息部分 */}
                    <h3 className="text-sm font-medium text-gray-500 mb-2">系统信息</h3>
                    <div className="bg-white rounded-lg divide-y divide-gray-100 mb-4">
                        <InfoItem label="操作系统" value={formatOsInfo(osInfo.osType, osInfo.osArch)} />
                        <InfoItem label="内核版本" value={SING_BOX_VERSION} />

                        <div className='w-full flex justify-center'>
                            <div className="overflow-x-auto  max-w-[260px] py-2 rounded-md">
                                <p className="text-gray-500/50 text-[0.8rem] mt-1 whitespace-nowrap  cursor-pointer" onClick={async () => {
                                    const handleCopy = async (ua: string) => {
                                        await navigator.clipboard.writeText(ua);
                                    }
                                    toast.promise(handleCopy(ua), {
                                        loading: '正在复制',
                                        success: '复制成功',
                                        error: '复制失败',
                                    });

                                }}>{ua}</p>
                            </div>

                        </div>


                    </div>

                    {/* 版权信息部分 */}
                    <div className='flex justify-between  items-center mb-2'>
                        <h3 className="text-sm font-medium text-gray-500 ">版权信息</h3>
                        <div className='flex gap-1  '>

                            <button className='btn  btn-circle btn-sm  border-0 ' onClick={() => openUrl(OFFICIAL_WEBSITE)}>
                                <Globe className="text-[#007AFF]" size={20} />
                            </button>

                            <button className='btn btn-circle  btn-sm  border-0' onClick={() => openUrl(GITHUB_URL)}>
                                <Github className="text-[#007AFF]" size={20} />

                            </button>
                        </div>
                    </div>
                    <pre className="text-xs text-gray-600 whitespace-pre-wrap bg-white p-3 rounded-lg">
                        {aboutText}
                    </pre>
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

