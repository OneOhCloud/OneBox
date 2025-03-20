import { useState } from 'react';
import { PageState, SubscriptionConfig } from '../types/SubscriptionConfig';

export const useSubscriptionConfig = () => {
    // 模拟数据
    const [configs, setConfigs] = useState<SubscriptionConfig[]>([
        // 生成测试数据
        ...Array.from({ length: 300 }, (_, index) => ({
            id: `config-${index + 1}`,
            name: `订阅配置 ${index + 1}`,
            url: `https://example.com/subscription${index + 1}.txt`,
            expires: Date.now() + 1000 * 60 * 60 * 24,
            updateInterval: 5,
            lastUpdated: Date.now() - 1000 * 60 * 60,
            dataUsed: Math.floor(Math.random() * 1000),
            dataTotal: Math.floor(Math.random() * 10000) + 1000,

        }))
    ]);

    const [pageState, setPageState] = useState<PageState>(PageState.LIST);
    const [currentConfig, setCurrentConfig] = useState<SubscriptionConfig | null>(null);
    const [formData, setFormData] = useState({
        name: '',
        url: '',
        interval: 5
    });

    // 切换到添加配置页面
    const goToAddConfig = () => {
        setFormData({ name: '', url: '', interval: 5 });
        setPageState(PageState.ADD_CONFIG);
    };

    // 切换到编辑配置页面
    const goToEditConfig = (config: SubscriptionConfig) => {
        setCurrentConfig(config);
        setFormData({
            name: config.name,
            url: config.url,
            interval: config.updateInterval
        });
        setPageState(PageState.EDIT_CONFIG);
    };

    // 返回到列表页面
    const backToList = () => {
        setPageState(PageState.LIST);
    };

    // 更新表单数据
    const updateFormData = (field: string, value: string | number) => {
        setFormData({
            ...formData,
            [field]: value
        });
    };

    // 添加新的配置
    const addConfig = () => {
        if (formData.name.trim() === '' || formData.url.trim() === '') {
            alert('名称和URL不能为空');
            return;
        }

        const newConfig: SubscriptionConfig = {
            id: Date.now().toString(),
            name: formData.name,
            url: formData.url,
            updateInterval: formData.interval
        };

        setConfigs([...configs, newConfig]);
        backToList();
    };

    // 更新配置
    const updateConfig = () => {
        if (!currentConfig) return;
        if (formData.name.trim() === '' || formData.url.trim() === '') {
            alert('名称和URL不能为空');
            return;
        }

        const updatedConfigs = configs.map(config =>
            config.id === currentConfig.id
                ? { 
                    ...config, 
                    name: formData.name, 
                    url: formData.url, 
                    updateInterval: formData.interval 
                }
                : config
        );

        setConfigs(updatedConfigs);
        backToList();
    };

    // 删除配置
    const deleteConfig = (id: string) => {
        if (confirm('确定要删除这个配置吗？')) {
            setConfigs(configs.filter(config => config.id !== id));
        }
    };

    return {
        configs,
        pageState,
        currentConfig,
        formData,
        goToAddConfig,
        goToEditConfig,
        backToList,
        updateFormData,
        addConfig,
        updateConfig,
        deleteConfig
    };
};
