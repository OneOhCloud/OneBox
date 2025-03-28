import { Arch, OsType } from "@tauri-apps/plugin-os"

export const GITHUB_URL = 'https://github.com/OneOhCloud/OneBox'
export const OFFICIAL_WEBSITE = 'https://oneoh.cloud'
export const SING_BOX_VERSION = '1.11.5'

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

export type SubscriptionConfig  = {
    id: number
    identifier: string
    config_content: string

}


// 获取订阅列表的 SWR 键
export const GET_SUBSCRIPTIONS_LIST_SWR_KEY = 'get-subscriptions-list'
