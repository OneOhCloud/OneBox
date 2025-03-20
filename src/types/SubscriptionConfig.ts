// 定义订阅配置类型
export interface SubscriptionConfig {
    id: string;
    name: string;
    url: string;
    updateInterval: number;  // 分钟
    expires?: number;        // 时间戳
    lastUpdated?: number;    // 最后更新时间戳
    dataUsed?: number;       // 已用流量（字节）
    dataTotal?: number;      // 总流量（字节）
    // 其他可能的字段
}

// 页面状态枚举
export enum PageState {
    LIST,
    ADD_CONFIG,
    EDIT_CONFIG
}
