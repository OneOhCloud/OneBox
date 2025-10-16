import { useState } from "react";
import { Plus, QuestionCircle, Trash } from "react-bootstrap-icons";
import { t } from "../../utils/helper";
import { HelpModal } from "./help-modal";


interface RuleSet {
    domain: string[];
    domain_suffix: string[];
    ip_cidr: string[];
}



interface TabContentProps {
    rules: RuleSet;
    addRule: (type: keyof RuleSet, value: string) => void;
    removeRule: (type: keyof RuleSet, index: number) => void;
    domainInput: string;
    setDomainInput: (v: string) => void;
    domainSuffixInput: string;
    setDomainSuffixInput: (v: string) => void;
    ipCidrInput: string;
    setIpCidrInput: (v: string) => void;
}

export function TabContent({ rules, addRule, removeRule, domainInput, setDomainInput, domainSuffixInput, setDomainSuffixInput, ipCidrInput, setIpCidrInput }: TabContentProps) {
    const [showHelp, setShowHelp] = useState(false);

    return (
        <div className="px-4 py-2 space-y-6  h-[400px] overflow-y-auto  ">
            {/* 域名规则 */}
            <HelpModal isOpen={showHelp} onClose={() => setShowHelp(false)} />

            <div className="space-y-3">
                <h3 className="text-sm text-gray-600 flex items-center justify-between">
                    <div>{t('domain_rules', 'Domain')}</div>
                    <button
                        onClick={() => setShowHelp(true)}
                        className="cursor-pointer hover:bg-gray-200 hover:text-gray-800 p-2 rounded-full"
                    >
                        <QuestionCircle size={14} />
                    </button>
                </h3>
                <div className="flex gap-2">
                    <input
                        type="text"
                        className="flex-1 px-3 py-2 text-sm bg-gray-50 text-gray-700 rounded outline-none focus:bg-gray-100 transition-colors"
                        placeholder="example.com"
                        value={domainInput}
                        onChange={(e) => setDomainInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && addRule('domain', domainInput)}
                    />
                    <button
                        className="px-3 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded transition-colors"
                        onClick={() => addRule('domain', domainInput)}
                    >
                        <Plus size={14} />
                    </button>
                </div>
                {rules.domain.length > 0 && (
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                        {rules.domain.map((rule, index) => (
                            <div key={index} className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded group hover:bg-gray-100 transition-colors">
                                <span className="text-sm text-gray-600 truncate flex-1">{rule}</span>
                                <button
                                    className="p-1 text-gray-400 hover:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity"
                                    onClick={() => removeRule('domain', index)}
                                >
                                    <Trash size={14} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* 域名后缀规则 */}
            <div className="space-y-3">
                <h3 className="text-sm text-gray-600">
                    {t('domain_suffix_rules', 'Domain Suffix')}
                </h3>
                <div className="flex gap-2">
                    <input
                        type="text"
                        className="flex-1 px-3 py-2 text-sm bg-gray-50 text-gray-700 rounded outline-none focus:bg-gray-100 transition-colors"
                        placeholder=".example.com"
                        value={domainSuffixInput}
                        onChange={(e) => setDomainSuffixInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && addRule('domain_suffix', domainSuffixInput)}
                    />
                    <button
                        className="px-3 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded transition-colors"
                        onClick={() => addRule('domain_suffix', domainSuffixInput)}
                    >
                        <Plus size={14} />
                    </button>
                </div>
                {rules.domain_suffix.length > 0 && (
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                        {rules.domain_suffix.map((rule, index) => (
                            <div key={index} className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded group hover:bg-gray-100 transition-colors">
                                <span className="text-sm text-gray-600 truncate flex-1">{rule}</span>
                                <button
                                    className="p-1 text-gray-400 hover:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity"
                                    onClick={() => removeRule('domain_suffix', index)}
                                >
                                    <Trash size={14} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* IP CIDR 规则 */}
            <div className="space-y-3">
                <h3 className="text-sm text-gray-600">
                    {t('ip_cidr_rules', 'IP CIDR')}
                </h3>
                <div className="flex gap-2">
                    <input
                        type="text"
                        className="flex-1 px-3 py-2 text-sm bg-gray-50 text-gray-700 rounded outline-none focus:bg-gray-100 transition-colors"
                        placeholder="192.168.1.0/24"
                        value={ipCidrInput}
                        onChange={(e) => setIpCidrInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && addRule('ip_cidr', ipCidrInput)}
                    />
                    <button
                        className="px-3 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded transition-colors"
                        onClick={() => addRule('ip_cidr', ipCidrInput)}
                    >
                        <Plus size={14} />
                    </button>
                </div>
                {rules.ip_cidr.length > 0 && (
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                        {rules.ip_cidr.map((rule, index) => (
                            <div key={index} className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded group hover:bg-gray-100 transition-colors">
                                <span className="text-sm text-gray-600 truncate flex-1">{rule}</span>
                                <button
                                    className="p-1 text-gray-400 hover:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity"
                                    onClick={() => removeRule('ip_cidr', index)}
                                >
                                    <Trash size={14} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
