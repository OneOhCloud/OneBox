import { Globe, ShieldCheck } from "react-bootstrap-icons";
import { t } from "../../utils/helper";

interface HelpModalProps {
    isOpen: boolean;
    onClose: () => void;
}

// 帮助信息弹窗组件
export function HelpModal({ isOpen, onClose }: HelpModalProps) {
    if (!isOpen) return null;
    return (
        <dialog className="modal modal-open">
            <div className="modal-box max-w-md bg-white border border-gray-200">
                <h3 className="font-semibold text-base text-gray-900 mb-4">{t('rule_info_title', 'Rule Information')}</h3>
                <div className="space-y-3">
                    <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                        <p className="font-medium text-gray-900 mb-1.5 flex items-center gap-2">
                            <ShieldCheck size={16} className="text-gray-700" />
                            {t('direct_rules', 'Direct Rules')}
                        </p>
                        <p className="text-gray-600 text-xs leading-relaxed">{t('direct_rules_info', 'Direct rules: Traffic will bypass proxy')}</p>
                    </div>
                    <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                        <p className="font-medium text-gray-900 mb-1.5 flex items-center gap-2">
                            <Globe size={16} className="text-gray-700" />
                            {t('proxy_rules', 'Proxy Rules')}
                        </p>
                        <p className="text-gray-600 text-xs leading-relaxed">{t('proxy_rules_info', 'Proxy rules: Traffic will go through proxy')}</p>
                    </div>
                    <div className="divider my-3"></div>
                    <div className="space-y-2 text-xs text-gray-600 leading-relaxed">
                        <p>• <strong className="text-gray-800">{t('domain_rules', 'Domain Rules')}:</strong> {t('domain_rules_desc', 'Match exact domain names, e.g., example.com')}</p>
                        <p>• <strong className="text-gray-800">{t('domain_suffix_rules', 'Domain Suffix Rules')}:</strong> {t('domain_suffix_rules_desc', 'Match domain suffixes, e.g., .com, .cn')}</p>
                        <p>• <strong className="text-gray-800">{t('ip_cidr_rules', 'IP CIDR Rules')}:</strong> {t('ip_cidr_rules_desc', 'Match IP ranges, e.g., 192.168.1.0/24')}</p>
                    </div>
                    <div className="bg-gray-100 p-3 rounded-lg mt-3 border border-gray-200">
                        <span className="text-xs text-gray-700">{t('rules_auto_save', 'Rules are automatically saved when added or removed')}</span>
                    </div>
                </div>
                <div className="modal-action mt-5">
                    <button className="btn btn-sm bg-gray-900 hover:bg-gray-800 text-white border-0" onClick={onClose}>{t('close', 'Close')}</button>
                </div>
            </div>
            <div className="modal-backdrop bg-gray-900/20" onClick={onClose}></div>
        </dialog>
    );
}
