import { Arch, OsType } from "@tauri-apps/plugin-os";

// 跳过 13.1 版本，有严重 bug。
export const SING_BOX_MAJOR_VERSION = "1.13";
export const SING_BOX_MINOR_VERSION = "8";
export const SING_BOX_VERSION = `v${SING_BOX_MAJOR_VERSION}.${SING_BOX_MINOR_VERSION}`;

export const GITHUB_URL = 'https://github.com/OneOhCloud/OneBox'
export const OFFICIAL_WEBSITE = 'https://sing-box.net'
export const SSI_STORE_KEY = 'selected_subscription_identifier'
export const DEVELOPER_TOGGLE_STORE_KEY = 'developer_toggle_key'
export const STAGE_VERSION_STORE_KEY = 'stage_version_key'
export const TUN_STACK_STORE_KEY = 'tun_stack_key'
export const TUN_INTERFACE_NAME = 'utun233'
export const USE_DHCP_STORE_KEY = 'use_dhcp_key'
export const ENABLE_BYPASS_ROUTER_STORE_KEY = 'enable_bypass_router_key'
export const SUPPORT_LOCAL_FILE_STORE_KEY = 'support_local_file_key'
// User Agent 配置键
export const USER_AGENT_STORE_KEY = 'user_agent_key'

// 上次检查更新的时间戳（ms），跨会话持久化
export const LAST_UPDATE_CHECK_TIME_KEY = 'last_update_check_time_key'

// 上次签名校验失败的时间戳（ms）。stable 通道在 1 小时内禁用
// 手动检查更新，避免反复触发服务器缓存导致的失败。
export const LAST_SIGNATURE_FAILURE_TIME_KEY = 'last_signature_failure_time_key'

// 更新安装触发时间戳（ms）。tauri-plugin-updater 把当前进程 argv 通过 NSIS
// `/ARGS` 原样转发给新 exe，包括深链 URL —— 冷启动时会被识别成"新的深链",
// 造成每次更新重启都重复 import + apply。install() 之前写入这个 key，Rust
// 冷启动 setup 读到且在 5 分钟内则跳过 argv 深链。best-effort 清除；即使
// 清除失败，TTL 保证最多 5 分钟后自动失效，避免死锁深链功能。
export const UPDATE_SUPPRESS_ARGV_DEEPLINK_AT_KEY = 'update_suppress_argv_deeplink_at'

// 允许局域网连接
export const ALLOWLAN_STORE_KEY = 'allow_lan_key'
// 是否启用 tun 模式
export const ENABLE_TUN_STORE_KEY = 'enable_tun_key'
// 当前规则模式
export const RULE_MODE_STORE_KEY = 'rule_mode_key'

export type OsInfo = {
    appVersion: string,
    osArch: Arch,
    osType: OsType,
    osVersion: string,
    osLocale: string | null,
}


export type Subscription = {
    id: number
    identifier: string
    name: string
    used_traffic: number
    total_traffic: number
    subscription_url: string
    official_website: string
    expire_time: number
    last_update_time: number
}

export type SubscriptionConfig = {
    id: number
    identifier: string
    config_content: string

}


// 获取订阅列表的 SWR 键
export const GET_SUBSCRIPTIONS_LIST_SWR_KEY = 'get-subscriptions-list'

export interface TerminatedPayload {
    code: number | null;
    signal: number | null;
}

export type StatusChangedPayload = void | TerminatedPayload;