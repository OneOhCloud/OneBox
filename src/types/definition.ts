import { Arch, OsType } from "@tauri-apps/plugin-os"

export const GITHUB_URL = 'https://github.com/OneOhCloud/OneBox'
export const OFFICIAL_WEBSITE = 'https://sing-box.net'
export const SING_BOX_VERSION = "v1.11.15"
export const SSI_STORE_KEY = 'selected_subscription_identifier'
export const DEVELOPER_TOGGLE_STORE_KEY = 'developer_toggle_key'
export const STAGE_VERSION_STORE_KEY = 'stage_version_key'



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
