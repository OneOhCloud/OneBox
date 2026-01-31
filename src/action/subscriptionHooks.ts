import { useCallback, useState } from "react";
import { getDataBaseInstance } from "../single/db";
import { Subscription } from "../types/definition";
import { t } from "../utils/helper";
import { fetchConfigContent, FileError, getRemoteInfoBySubscriptionUserinfo } from "./db";


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