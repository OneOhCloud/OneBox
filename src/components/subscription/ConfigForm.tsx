import { ArrowLeft, CheckCircle } from 'react-bootstrap-icons';

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
        <div className="bg-gray-50 min-h-screen pt-4">
            <div className="container mx-auto px-4 max-w-md">
                <div className="flex items-center mb-6">
                    <button
                        className="btn btn-ghost btn-sm mr-2 p-2"
                        onClick={onCancel}
                    >
                        <ArrowLeft size={18} className="text-[#007AFF]" />
                    </button>
                    <h1 className="text-xl font-bold text-[#1C1C1E]">{title}</h1>
                </div>

                <div className="rounded-xl overflow-hidden bg-white shadow-sm mb-6">
                    <div className="p-4 divide-y divide-gray-100">
                        <div className="form-control w-full mb-3">
                            <label className="label pb-1">
                                <span className="label-text font-medium text-[#1C1C1E]">名称</span>
                            </label>
                            <input
                                type="text"
                                placeholder="输入配置名称"
                                className="input input-bordered w-full bg-gray-50 border border-gray-200"
                                value={name}
                                onChange={(e) => onNameChange(e.target.value)}
                            />
                        </div>

                        <div className="form-control w-full mb-3 pt-3">
                            <label className="label pb-1">
                                <span className="label-text font-medium text-[#1C1C1E]">URL</span>
                            </label>
                            <input
                                type="text"
                                placeholder="输入订阅URL"
                                className="input input-bordered w-full bg-gray-50 border border-gray-200"
                                value={url}
                                onChange={(e) => onUrlChange(e.target.value)}
                            />
                        </div>

                        <div className="form-control w-full mb-3 pt-3">
                            <label className="label pb-1">
                                <span className="label-text font-medium text-[#1C1C1E]">自动更新周期（分钟）</span>
                            </label>
                            <input
                                type="number"
                                className="input input-bordered w-full bg-gray-50 border border-gray-200"
                                value={interval}
                                onChange={(e) => onIntervalChange(parseInt(e.target.value) || 5)}
                                min="1"
                            />
                        </div>
                    </div>
                </div>

                <div className="flex justify-between mt-6">
                    <button
                        className="btn btn-outline border-[#8E8E93] text-[#8E8E93] hover:bg-gray-100 hover:border-gray-300 hover:text-gray-700"
                        onClick={onCancel}
                    >
                        取消
                    </button>
                    <button
                        className="btn bg-[#007AFF] hover:bg-blue-600 text-white border-none"
                        onClick={onSubmit}
                    >
                        <CheckCircle className="mr-2" /> 完成
                    </button>
                </div>
            </div>
        </div>
    );
};
