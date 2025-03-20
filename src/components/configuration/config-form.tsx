import { ArrowLeft, Clock, Link, Wifi } from 'react-bootstrap-icons';

interface ConfigFormProps {
    title: string;
    name: string;
    url: string;
    interval: number;
    onNameChange: (name: string) => void;
    onUrlChange: (url: string) => void;
    onIntervalChange: (interval: number) => void;
    onSubmit: () => void;
    onCancel: () => void;
}

export const ConfigForm = ({
    title,
    name,
    url,
    interval,
    onNameChange,
    onUrlChange,
    onIntervalChange,
    onSubmit,
    onCancel
}: ConfigFormProps) => {
    return (
        <div className="bg-gray-50 min-h-screen pt-3 pb-6">
            <div className="container mx-auto px-4 max-w-md">
                <div className="flex items-center mb-4">
                    <button
                        className="btn btn-sm btn-ghost btn-circle mr-2 p-1 hover:bg-blue-50 transition-colors duration-300"
                        onClick={onCancel}
                    >
                        <ArrowLeft size={16} className="text-blue-500" />
                    </button>
                    <h1 className="text-lg font-bold text-[#1C1C1E]">
                        {title}
                    </h1>
                </div>

                <div className="rounded-lg overflow-hidden bg-white shadow-sm mb-4">
                    <div className="p-4 space-y-4">
                        <div className="form-control w-full">
                            <div className="flex items-center mb-1">
                                <Wifi className="text-[#8E8E93] mr-1.5" size={14} />
                                <label className="label-text text-sm font-medium text-[#1C1C1E]">配置名称</label>
                            </div>
                            <input
                                type="text"
                                placeholder="输入配置名称"
                                className="input input-md w-full bg-gray-50 border-none focus:ring-1 focus:ring-blue-100 transition-all duration-300 rounded-lg placeholder:text-gray-400 h-9"
                                value={name}
                                onChange={(e) => onNameChange(e.target.value)}
                            />
                        </div>

                        <div className="form-control w-full">
                            <div className="flex items-center mb-1">
                                <Link className="text-[#8E8E93] mr-1.5" size={14} />
                                <label className="label-text text-sm font-medium text-[#1C1C1E]">订阅地址</label>
                            </div>
                            <input
                                type="text"
                                placeholder="输入订阅URL"
                                className="input input-md w-full bg-gray-50 border-none focus:ring-1 focus:ring-blue-100 transition-all duration-300 rounded-lg placeholder:text-gray-400 h-9"
                                value={url}
                                onChange={(e) => onUrlChange(e.target.value)}
                            />
                        </div>

                        <div className="form-control w-full">
                            <div className="flex items-center mb-1">
                                <Clock className="text-[#8E8E93] mr-1.5" size={14} />
                                <label className="label-text text-sm font-medium text-[#1C1C1E]">自动更新周期</label>
                            </div>
                            <div className="flex items-center">
                                <input
                                    type="number"
                                    className="input input-md w-full bg-gray-50 border-none focus:ring-1 focus:ring-blue-100 transition-all duration-300 rounded-lg h-9"
                                    value={interval}
                                    onChange={(e) => onIntervalChange(parseInt(e.target.value) || 5)}
                                    min="1"
                                />
                                <span className="ml-2 text-xs text-[#8E8E93]">分钟</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex justify-between mt-4">
                    <button
                        className="btn btn-sm btn-outline border-gray-300 text-[#8E8E93] hover:bg-gray-100 hover:border-gray-400 hover:text-gray-700 transition-all duration-300 rounded-lg px-4"
                        onClick={onCancel}
                    >
                        取消
                    </button>
                    <button
                        className="btn btn-sm bg-blue-500 hover:bg-blue-600 text-white border-none shadow-sm hover:shadow-md transition-all duration-300 hover:scale-105 rounded-lg px-4"
                        onClick={onSubmit}
                    >
                        完成
                    </button>
                </div>
            </div>
        </div>
    );
};
