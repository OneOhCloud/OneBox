
import { readTextFile } from '@tauri-apps/plugin-fs';
import { fetch } from '@tauri-apps/plugin-http';
import { toast } from 'sonner';
import { getDataBaseInstance } from '../single/db';
import { Subscription, SubscriptionConfig } from '../types/definition';
import { getSingBoxUserAgent, t } from '../utils/helper';


interface ResponseHeaders {
    'subscription-userinfo': string;
    'official-website': string;
    'content-disposition': string;
    get?: (name: string) => string | null;
}

interface ConfigResponse {
    data: any;
    headers: ResponseHeaders;
    status?: number;
}

class FileError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "FileError";
    }
}

async function fetchConfigContent(url: string): Promise<ConfigResponse> {
    if (url.startsWith('file://')) {
        const filePath = url.slice(7);
        try {
            const content = await readTextFile(filePath);
            return {
                data: JSON.parse(content),
                headers: {
                    'subscription-userinfo': `upload=0; download=0; total=1125899906842624; expire=32503680000`,
                    'official-website': 'https://sing-box.net',
                    'content-disposition': `attachment; filename=local-config-${Date.now()}.json`
                },
                status: 200
            };
        } catch (error) {
            throw new FileError(`${error}`);
        }
    } else {
        const response = await fetch(url, {
            method: 'GET',
            // @ts-ignore
            timeout: 30,
            headers: {
                'User-Agent': await getSingBoxUserAgent(),
            }
        });

        if (response.status !== 200) {
            return {
                data: null,
                headers: {
                    'subscription-userinfo': '',
                    'official-website': 'https://sing-box.net',
                    'content-disposition': ''
                },
                status: response.status
            };
        }

        return {
            data: await response.json(),
            headers: {
                'subscription-userinfo': response.headers.get('subscription-userinfo') || '',
                'official-website': response.headers.get('official-website') || 'https://sing-box.net',
                'content-disposition': response.headers.get('content-disposition') || ''
            },
            status: response.status
        };
    }
}

function getRemoteNameByContentDisposition(contentDisposition: string) {
    const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
    const matches = filenameRegex.exec(contentDisposition);
    if (matches != null && matches[1]) {
        return decodeURIComponent(matches[1].replace(/['"]/g, ''));
    }
    return null;
}


function getRemoteInfoBySubscriptionUserinfo(subscriptionUserinfo: string) {
    try {
        const info = subscriptionUserinfo.split('; ').reduce((acc, item) => {
            const [key, value] = item.split('=');
            if (key && value) {
                acc[key.trim()] = value.trim();
            }
            return acc;
        }, {} as Record<string, string>);

        return {
            upload: info.upload || '1',
            download: info.download || '1',
            total: info.total || '1',
            expire: info.expire || '1',
        };
    } catch (error) {
        console.error('Error parsing subscription userinfo:', error);
        return {
            upload: '1',
            download: '1',
            total: '1',
            expire: '1',
        };
    }
}

export async function updateSubscription(identifier: string) {
    try {
        const db = await getDataBaseInstance();
        const result: Subscription[] = await db.select('SELECT subscription_url FROM subscriptions WHERE identifier = ?', [identifier])
        if (result.length === 0) {
            toast.error(t('subscription_not_exist'))
            return
        }
        const url = result[0].subscription_url
        const response = await fetchConfigContent(url);

        const { upload, download, total, expire } = getRemoteInfoBySubscriptionUserinfo(response.headers['subscription-userinfo'] || '')
        const officialWebsite = response.headers['official-website'] || 'https://sing-box.net'
        const used_traffic = parseInt(upload) + parseInt(download)
        const total_traffic = parseInt(total)
        const expire_time = parseInt(expire) * 1000
        const last_update_time = Date.now()

        await db.execute(
            'UPDATE subscriptions SET official_website = ?, used_traffic = ?, total_traffic = ?, expire_time = ?, last_update_time = ? WHERE identifier = ?',
            [officialWebsite, used_traffic, total_traffic, expire_time, last_update_time, identifier]
        )
        await db.execute('UPDATE subscription_configs SET config_content = ? WHERE identifier = ?', [JSON.stringify(response.data), identifier])
        // toast.success('更新订阅成功')
        if (response.status !== 200) {
            toast.warning(t('update_subscription_failed'))
        } else {
            toast.success(t('update_subscription_success'))

        }

    } catch (error) {
        if (error instanceof FileError) {
            toast.error(`${error.message}`);
        } else {
            toast.error(t('update_subscription_failed'))

        }

    }


}



export async function addSubscription(url: string, name: string | undefined) {
    const toastId = toast.loading(t('adding_subscription'))
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
        toast.success(t('add_subscription_success'), {
            id: toastId
        })

    } catch (error) {
        console.error('Error adding subscription:', error)
        toast.error(t('add_subscription_failed'), {
            id: toastId,
            duration: 5000
        })
    }
}



// delete subscription by  identifier

export async function deleteSubscription(identifier: string) {
    try {
        const db = await getDataBaseInstance();
        await db.execute('DELETE FROM subscriptions WHERE identifier = ?', [identifier])
        await db.execute('DELETE FROM subscription_configs WHERE identifier = ?', [identifier])
        toast.success(t("delete_subscription_success"))
    } catch (error) {
        console.error('Error deleting subscription:', error)
        toast.error(t('delete_subscription_failed'))
    }
}


export async function getSubscriptionConfig(identifier: string) {
    try {
        const db = await getDataBaseInstance();
        const result: SubscriptionConfig[] = await db.select('SELECT config_content FROM subscription_configs WHERE identifier = ?', [identifier])
        if (result.length === 0) {
            // toast.error('订阅不存在')
            toast.error(t('subscription_not_exist'))
            return
        }
        return JSON.parse(result[0].config_content)
    } catch (error) {
        console.error('Error getting subscription config:', error)
        // toast.error('获取订阅配置失败')
        toast.error(t('get_subscription_config_failed'))
    }

}