import { PageState } from '../types/SubscriptionConfig';
import { ConfigList } from '../components/subscription/ConfigList';
import { ConfigForm } from '../components/subscription/ConfigForm';
import { useSubscriptionConfig } from '../hooks/useSubscriptionConfig';

export default function Configuration() {
    const {
        configs,
        pageState,
        formData,
        goToAddConfig,
        goToEditConfig,
        backToList,
        updateFormData,
        addConfig,
        updateConfig,
        deleteConfig
    } = useSubscriptionConfig();

    // 根据当前页面状态渲染不同内容
    return (
        <>
            {pageState === PageState.LIST && (
                <ConfigList
                    configs={configs}
                    onAddConfig={goToAddConfig}
                    onEditConfig={goToEditConfig}
                    onDeleteConfig={deleteConfig}
                />
            )}
            
            {pageState === PageState.ADD_CONFIG && (
                <ConfigForm
                    title="添加订阅配置"
                    name={formData.name}
                    url={formData.url}
                    interval={formData.interval}
                    onNameChange={(value) => updateFormData('name', value)}
                    onUrlChange={(value) => updateFormData('url', value)}
                    onIntervalChange={(value) => updateFormData('interval', value)}
                    onSubmit={addConfig}
                    onCancel={backToList}
                />
            )}
            
            {pageState === PageState.EDIT_CONFIG && (
                <ConfigForm
                    title="编辑订阅配置"
                    name={formData.name}
                    url={formData.url}
                    interval={formData.interval}
                    onNameChange={(value) => updateFormData('name', value)}
                    onUrlChange={(value) => updateFormData('url', value)}
                    onIntervalChange={(value) => updateFormData('interval', value)}
                    onSubmit={updateConfig}
                    onCancel={backToList}
                />
            )}
        </>
    );
}