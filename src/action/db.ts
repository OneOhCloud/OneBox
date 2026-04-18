
import { invoke } from '@tauri-apps/api/core';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { toast } from 'sonner';
import { getDataBaseInstance } from '../single/db';
import { Subscription, SubscriptionConfig } from '../types/definition';
import { getSingBoxUserAgent, t } from '../utils/helper';


export interface ResponseHeaders {
    'subscription-userinfo': string;
    'official-website': string;
    'content-disposition': string;
    get?: (name: string) => string | null;
}

export interface ConfigResponse {
    data: any;
    headers: ResponseHeaders;
    status?: number;
}

export class FileError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "FileError";
    }
}

export async function fetchConfigContent(url: string): Promise<ConfigResponse> {
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
        const result = await invoke<{
            data: unknown;
            headers: Record<string, string>;
            status: number;
        }>('fetch_config_with_optimal_dns', {
            url,
            userAgent: await getSingBoxUserAgent(),
        });

        return {
            data: result.data ?? null,
            headers: {
                'subscription-userinfo': result.headers['subscription-userinfo'] || '',
                'official-website': result.headers['official-website'] || 'https://sing-box.net',
                'content-disposition': result.headers['content-disposition'] || '',
            },
            status: result.status,
        };
    }
}

export function getRemoteNameByContentDisposition(contentDisposition: string) {
    const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
    const matches = filenameRegex.exec(contentDisposition);
    if (matches != null && matches[1]) {
        return decodeURIComponent(matches[1].replace(/['"]/g, ''));
    }
    return null;
}


export function getRemoteInfoBySubscriptionUserinfo(subscriptionUserinfo: string) {
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



/**
 * Removes duplicate subscription rows by URL, keeping the oldest entry (MIN id) per URL.
 * Orphaned subscription_configs rows are removed automatically via CASCADE.
 * Intended to be called once on every app startup.
 */
export async function deduplicateSubscriptionsByUrl(): Promise<void> {
    const db = await getDataBaseInstance();
    await db.execute(`
        DELETE FROM subscriptions
        WHERE id NOT IN (
            SELECT MAX(id) FROM subscriptions
            WHERE subscription_url IS NOT NULL
            GROUP BY subscription_url
        )
        AND subscription_url IS NOT NULL
    `);
}

// Tracks in-flight insertSubscription calls by URL.
// A second call for the same URL reuses the existing Promise instead of
// racing to INSERT a duplicate record into the database.
const inflightInsertions = new Map<string, Promise<string | undefined>>();

/**
 * Upserts a subscription by URL. If the URL already exists, updates config + traffic + name
 * and returns the existing identifier. If not, inserts a new row.
 * Returns the identifier on success, undefined on failure. No UI side-effects.
 *
 * Concurrent calls for the same URL are collapsed into a single operation to
 * prevent the TOCTOU race that would otherwise create duplicate DB records.
 */
export function insertSubscription(url: string, name?: string): Promise<string | undefined> {
    const inflight = inflightInsertions.get(url);
    if (inflight) return inflight;

    const promise = _insertSubscription(url, name).finally(() => {
        inflightInsertions.delete(url);
    });
    inflightInsertions.set(url, promise);
    return promise;
}

async function _insertSubscription(url: string, name?: string): Promise<string | undefined> {
    // Timings bracket each phase so the renderer log reveals whether the
    // dominant cost is the network fetch (Rust reqwest, see
    // `fetch_config_with_optimal_dns`), the DB upsert, or JSON parsing.
    const tTotal = performance.now();
    try {
        const tFetch = performance.now();
        const response = await fetchConfigContent(url);
        const fetchMs = Math.round(performance.now() - tFetch);
        console.info(`[import] fetch done status=${response.status} elapsed=${fetchMs}ms url=${url}`);
        if (response.status !== 200) {
            console.warn(`[import] abort non-200 status=${response.status} url=${url}`);
            return undefined;
        }

        const tDb = performance.now();
        const db = await getDataBaseInstance();
        const resolvedName = (!name || name === '默认配置')
            ? getRemoteNameByContentDisposition(response.headers['content-disposition'] || '') || '配置'
            : name;
        const { upload, download, total, expire } = getRemoteInfoBySubscriptionUserinfo(
            response.headers['subscription-userinfo'] || ''
        );
        const usedTraffic = parseInt(upload) + parseInt(download);
        const totalTraffic = parseInt(total);
        const expireTime = parseInt(expire) * 1000;

        const existing: { identifier: string }[] = await db.select(
            'SELECT identifier FROM subscriptions WHERE subscription_url = ? ORDER BY id DESC LIMIT 1',
            [url]
        );

        if (existing.length > 0) {
            const identifier = existing[0].identifier;
            await db.execute(
                'UPDATE subscriptions SET name = ?, used_traffic = ?, total_traffic = ?, expire_time = ?, last_update_time = ? WHERE identifier = ?',
                [resolvedName, usedTraffic, totalTraffic, expireTime, Date.now(), identifier]
            );
            await db.execute(
                'UPDATE subscription_configs SET config_content = ? WHERE identifier = ?',
                [JSON.stringify(response.data), identifier]
            );
            const dbMs = Math.round(performance.now() - tDb);
            console.info(`[import] db update elapsed=${dbMs}ms total=${Math.round(performance.now() - tTotal)}ms identifier=${identifier}`);
            return identifier;
        }

        const identifier = crypto.randomUUID().toString().replace(/-/g, '');
        await db.execute(
            'INSERT INTO subscriptions (identifier, name, subscription_url, official_website, used_traffic, total_traffic, expire_time, last_update_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [
                identifier, resolvedName, url,
                response.headers['official-website'] || 'https://sing-box.net',
                usedTraffic, totalTraffic, expireTime, Date.now(),
            ]
        );
        await db.execute(
            'INSERT INTO subscription_configs (identifier, config_content) VALUES (?, ?)',
            [identifier, JSON.stringify(response.data)]
        );
        const dbMs = Math.round(performance.now() - tDb);
        console.info(`[import] db insert elapsed=${dbMs}ms total=${Math.round(performance.now() - tTotal)}ms identifier=${identifier}`);
        return identifier;
    } catch (err) {
        console.error(`[import] error total=${Math.round(performance.now() - tTotal)}ms err=${err instanceof Error ? err.message : String(err)} url=${url}`);
        return undefined;
    }
}

export async function addSubscription(url: string, name: string | undefined) {
    const toastId = toast.loading(t('adding_subscription'))
    try {
        const response = await fetchConfigContent(url);

        const officialWebsite = response.headers['official-website'] || 'https://sing-box.net'

        if (name === undefined || name === '' || name === "默认配置") {
            name = getRemoteNameByContentDisposition(response.headers['content-disposition'] || '') || '配置'
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

export async function renameSubscription(identifier: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    const db = await getDataBaseInstance();
    await db.execute(
        'UPDATE subscriptions SET name = ? WHERE identifier = ?',
        [trimmed, identifier]
    );
}

export async function deleteSubscription(identifier: string) {
    try {
        const db = await getDataBaseInstance();
        await db.execute('DELETE FROM subscriptions WHERE identifier = ?', [identifier])
        await db.execute('DELETE FROM subscription_configs WHERE identifier = ?', [identifier])
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