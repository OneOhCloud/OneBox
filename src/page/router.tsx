import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { TabContent } from '../components/router-settings/tab-content';
import { getCustomRuleSet, setCustomRuleSet } from '../single/store';
import { t } from '../utils/helper';

type RuleType = 'direct' | 'proxy';

interface RuleSet {
    domain: string[];
    domain_suffix: string[];
    ip_cidr: string[];
}



// Tab内容组件


export default function RouterSettings() {
    const [activeTab, setActiveTab] = useState<RuleType>('direct');
    const [directRules, setDirectRules] = useState<RuleSet>({ domain: [], domain_suffix: [], ip_cidr: [] });
    const [proxyRules, setProxyRules] = useState<RuleSet>({ domain: [], domain_suffix: [], ip_cidr: [] });

    // 输入框状态
    const [domainInput, setDomainInput] = useState('');
    const [domainSuffixInput, setDomainSuffixInput] = useState('');
    const [ipCidrInput, setIpCidrInput] = useState('');

    useEffect(() => {
        loadRules();
    }, []);

    const loadRules = async () => {
        try {
            const direct = await getCustomRuleSet('direct');
            const proxy = await getCustomRuleSet('proxy');
            setDirectRules(direct);
            setProxyRules(proxy);
        } catch (error) {
            console.error('加载规则失败:', error);
            toast.error(t('load_rules_failed', 'Failed to load rules'));
        }
    };

    const getCurrentRules = () => activeTab === 'direct' ? directRules : proxyRules;
    const setCurrentRules = (rules: RuleSet) => {
        if (activeTab === 'direct') {
            setDirectRules(rules);
        } else {
            setProxyRules(rules);
        }
    };

    const addRule = (type: keyof RuleSet, value: string) => {
        if (!value.trim()) {
            toast.error(t('input_empty', 'Input cannot be empty'));
            return;
        }
        const currentRules = getCurrentRules();
        if (currentRules[type].includes(value.trim())) {
            toast.error(t('rule_exists', 'Rule already exists'));
            return;
        }
        const newRules = {
            ...currentRules,
            [type]: [...currentRules[type], value.trim()]
        };
        setCurrentRules(newRules);
        // 清空输入框
        if (type === 'domain') setDomainInput('');
        if (type === 'domain_suffix') setDomainSuffixInput('');
        if (type === 'ip_cidr') setIpCidrInput('');
        // 自动保存
        setCustomRuleSet(activeTab, newRules);
        toast.success(t('add_success', 'Added successfully'));
    };

    const removeRule = (type: keyof RuleSet, index: number) => {
        const currentRules = getCurrentRules();
        const newRules = {
            ...currentRules,
            [type]: currentRules[type].filter((_, i) => i !== index)
        };
        setCurrentRules(newRules);
        // 自动保存
        setCustomRuleSet(activeTab, newRules);
        toast.success(t('delete_success', 'Deleted successfully'));
    };

    return (
        <div className="min-h-screen bg-gray-50 p-2">

            <div className="mx-auto max-w-4xl">


                {/* 标签切换导航 */}
                <div className="mb-2 flex gap-2 rounded-lg bg-gray-100 p-1">
                    <button
                        onClick={() => setActiveTab('direct')}
                        className={`flex-1 rounded-md px-6 py-2 text-xs font-medium transition-all ${activeTab === 'direct'
                            ? 'bg-gray-300 text-gray-800'
                            : 'text-gray-600 hover:bg-gray-200'
                            }`}
                    >
                        {t('direct_rules', '直连规则')}
                    </button>
                    <button
                        onClick={() => setActiveTab('proxy')}
                        className={`flex-1 rounded-md px-6 py-2 text-xs font-medium transition-all ${activeTab === 'proxy'
                            ? 'bg-gray-300 text-gray-800'
                            : 'text-gray-600 hover:bg-gray-200'
                            }`}
                    >
                        {t('proxy_rules', '代理规则')}
                    </button>
                </div>

                <div>
                    {/* 添加规则后需要重启VPN才能生效 */}
                    <div className="px-4 mb-2 text-xs text-gray-600">
                        {t('rules_effective_info', 'Rules take effect after restarting the VPN')}
                    </div>
                </div>

                {/* 内容区域 */}
                <div className="rounded-lg bg-white ">
                    {activeTab === 'direct' ? (
                        <TabContent
                            rules={directRules}
                            addRule={addRule}
                            removeRule={removeRule}
                            domainInput={domainInput}
                            setDomainInput={setDomainInput}
                            domainSuffixInput={domainSuffixInput}
                            setDomainSuffixInput={setDomainSuffixInput}
                            ipCidrInput={ipCidrInput}
                            setIpCidrInput={setIpCidrInput}
                        />
                    ) : (
                        <TabContent
                            rules={proxyRules}
                            addRule={addRule}
                            removeRule={removeRule}
                            domainInput={domainInput}
                            setDomainInput={setDomainInput}
                            domainSuffixInput={domainSuffixInput}
                            setDomainSuffixInput={setDomainSuffixInput}
                            ipCidrInput={ipCidrInput}
                            setIpCidrInput={setIpCidrInput}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
