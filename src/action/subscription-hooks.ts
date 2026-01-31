import { useCallback, useState } from "react";
import { getDataBaseInstance } from "../single/db";
import { Subscription } from "../types/definition";
import { t } from "../utils/helper";
import { fetchConfigContent, FileError, getRemoteInfoBySubscriptionUserinfo, getRemoteNameByContentDisposition } from "./db";


type MessageType = 'success' | 'error' | 'warning' | undefined;

export function useUpdateSubscription() {
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<string>('');
    const [messageType, setMessageType] = useState<MessageType>();

    const resetMessage = () => {
        setMessage('');
        setMessageType(undefined);
    };

    const update = useCallback(async (identifier: string) => {
        setLoading(true);
        setMessage('');
        setMessageType(undefined);
        try {
            const db = await getDataBaseInstance();
            const result: Subscription[] = await db.select('SELECT subscription_url FROM subscriptions WHERE identifier = ?', [identifier])
            if (result.length === 0) {
                setMessage(t('subscription_not_exist'));
                setMessageType('error');
                setLoading(false);
                return;
            }

            const url = result[0].subscription_url;
            const response = await fetchConfigContent(url);
            const { upload, download, total, expire } = getRemoteInfoBySubscriptionUserinfo(response.headers['subscription-userinfo'] || '');
            const officialWebsite = response.headers['official-website'] || 'https://sing-box.net';
            const used_traffic = parseInt(upload) + parseInt(download);
            const total_traffic = parseInt(total);
            const expire_time = parseInt(expire) * 1000;
            const last_update_time = Date.now();

            await db.execute(
                'UPDATE subscriptions SET official_website = ?, used_traffic = ?, total_traffic = ?, expire_time = ?, last_update_time = ? WHERE identifier = ?',
                [officialWebsite, used_traffic, total_traffic, expire_time, last_update_time, identifier]
            );
            await db.execute('UPDATE subscription_configs SET config_content = ? WHERE identifier = ?', [JSON.stringify(response.data), identifier]);
            if (response.status !== 200) {
                setMessage(t('update_subscription_failed'));
                setMessageType('warning');
            } else {
                setMessage(t('update_subscription_success'));
                setMessageType('success');
            }
        } catch (error) {
            if (error instanceof FileError) {
                setMessage(error.message);
                setMessageType('error');
            } else {
                setMessage(t('update_subscription_failed'));
                setMessageType('error');
            }
        } finally {
            setLoading(false);
        }
    }, []);

    return { update, resetMessage, loading, message, messageType };
}



export function useAddSubscription() {
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<string>('');
    const [messageType, setMessageType] = useState<MessageType>();

    const resetMessage = () => {
        setMessage('');
        setMessageType(undefined);
    };

    const add = useCallback(async (url: string, name: string | undefined) => {
        setLoading(true);
        setMessage('');
        setMessageType(undefined);
        try {
            const response = await fetchConfigContent(url);

            const officialWebsite = response.headers['official-website'] || 'https://sing-box.net'

            if (name === undefined || name === '' || name === "默认配置") {
                name = getRemoteNameByContentDisposition(response.headers['content-disposition'] || '') || '订阅'
            }

            const { upload, download, total, expire } = getRemoteInfoBySubscriptionUserinfo(response.headers['subscription-userinfo'] || '')
            const identifier = crypto.randomUUID().toString().replace(/-/g, '')
            const used_traffic = parseInt(upload) + parseInt(download)
            const total_traffic = parseInt(total)
            const expire_time = parseInt(expire) * 1000
            const last_update_time = Date.now()
            const db = await getDataBaseInstance();
            await db.execute('INSERT INTO subscriptions (identifier, name, subscription_url, official_website, used_traffic, total_traffic, expire_time, last_update_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [identifier, name, url, officialWebsite, used_traffic, total_traffic, expire_time, last_update_time])
            await db.execute('INSERT INTO subscription_configs (identifier, config_content) VALUES (?, ?)', [identifier, JSON.stringify(response.data)])
            setMessage(t('add_subscription_success'));
            setMessageType('success');
        } catch (error) {
            console.error('Error adding subscription:', error)
            setMessage(t('add_subscription_failed'));
            setMessageType('error');
        } finally {
            setLoading(false);
        }
    }, []);

    return { add, resetMessage, loading, message, messageType };
}