// 定义订阅配置类型
export interface SubscriptionConfig {
    id: string;
    name: string;
    url: string;
    expires?: string; // 过期时间
    updateInterval: number; // 自动更新周期，单位：分钟
}

// 页面状态枚举
export enum PageState {
    LIST,
    ADD_CONFIG,
    EDIT_CONFIG
}
