import toast from 'react-hot-toast';
import useSWR from 'swr';
import { getDataBaseInstance } from '../single/db';
import { GET_SUBSCRIPTIONS_LIST_SWR_KEY, Subscription } from '../types/definition';





const subscriptionsFetcher = async () => {
    try {
        const db = await getDataBaseInstance();
        return await db.select('SELECT * FROM subscriptions') as Subscription[]
    } catch (error) {
        console.error('Error fetching subscriptions:', error)
        toast.error(`订阅失败 ${error}`)
        return []

    }
}

export function useSubscriptions() {
    return useSWR<Subscription[]>(GET_SUBSCRIPTIONS_LIST_SWR_KEY, subscriptionsFetcher)
}

