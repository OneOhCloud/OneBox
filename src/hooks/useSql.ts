import Database from '@tauri-apps/plugin-sql'
import toast from 'react-hot-toast'
import useSWR from 'swr'
import { Subscription } from './definition'

const db = await Database.load('sqlite:data.db')



// 获取订阅列表的fetcher函数
const subscriptionsFetcher = async () => {
    try {
        return await db.select('SELECT * FROM subscriptions') as Subscription[]
    } catch (error) {
        console.error('Error fetching subscriptions:', error)
        toast.error('获取订阅失败')
        throw error
    }
}

export function useSubscriptions() {
    return useSWR<Subscription[]>('subscriptions', subscriptionsFetcher)
}


