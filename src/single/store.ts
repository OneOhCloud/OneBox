import { invoke } from '@tauri-apps/api/core';
import { locale, type } from '@tauri-apps/plugin-os';
import { LazyStore } from '@tauri-apps/plugin-store';
import { toast } from 'sonner';
import { configType, isStageVersion, StageVersionType } from '../config/common';
import { BUILD_TIME_TEMPLATE_SOURCE } from '../config/templates/generated';
import { emptyRuleSet, type RuleAction, type RuleSet } from '../config/merger/custom-rules';
import { ALLOWLAN_STORE_KEY, DEFAULT_PROXY_PORT, ENABLE_BYPASS_ROUTER_STORE_KEY, ENABLE_TUN_STORE_KEY, PROXY_MODE_STORE_KEY, PROXY_PORT_STORE_KEY, ProxyTransportMode, SHOW_NODE_PROTOCOL_STORE_KEY, SING_BOX_TEMPLATE_VERSION, SKIP_SYSTEM_PROXY_STORE_KEY, STAGE_VERSION_STORE_KEY, USE_DHCP_STORE_KEY, USER_AGENT_STORE_KEY } from '../types/definition';
import { deriveProxyTransportMode, isProxyTransportMode } from '../utils/proxy-mode';

const OsType = type();
export const LANGUAGE_STORE_KEY = 'language';
export const CLASH_API_SECRET = 'clash_api_secret_key';


export const store = new LazyStore('settings.json', {
    defaults: {},
    autoSave: true
});



export const getLanguage = async () => {
    const language = await getStoreValue(LANGUAGE_STORE_KEY) as string | undefined;
    if (language) {
        return language;
    }
    const osLocale = await locale();
    if (osLocale) {
        if (osLocale.startsWith('zh')) {
            return 'zh';

        } else {
            return 'en';
        }
    }
    return 'en';
};

export const setLanguage = async (language: string) => {
    await setStoreValue(LANGUAGE_STORE_KEY, language);
};


export async function getStoreValue(key: string, defaultValue?: any): Promise<any> {
    let value = await store.get(key);

    // zh: 如果 defaultValue 存在且 value 为 undefined、null 或空字符串，则返回 val
    // en: If defaultValue exists and value is undefined, null, or an empty string, return val
    if (defaultValue && (value === undefined || value === null || value === '')) {
        console.debug(`Store key "${key}" is empty, returning default value.`);
        return defaultValue;
    }
    console.debug(`Store key "${key}" found, returning stored value.`);
    return value;
}
export async function setStoreValue(key: string, value: any) {
    await store.set(key, value);
    await store.save();
}


/**
 * The proxy transport mode is the single source of truth for how traffic is
 * captured. Installs written before the enum existed only have the
 * `enable_tun_key` / `skip_system_proxy_key` pair, so the first read derives
 * the mode from them and writes it back; the legacy keys are never read again.
 */
export async function getProxyTransportMode(): Promise<ProxyTransportMode> {
    const stored = await store.get(PROXY_MODE_STORE_KEY);
    if (isProxyTransportMode(stored)) {
        return stored;
    }
    const migrated = deriveProxyTransportMode(
        await store.get(ENABLE_TUN_STORE_KEY),
        await store.get(SKIP_SYSTEM_PROXY_STORE_KEY),
    );
    await setProxyTransportMode(migrated);
    return migrated;
}

export async function setProxyTransportMode(mode: ProxyTransportMode) {
    await store.set(PROXY_MODE_STORE_KEY, mode);
    await store.save();
}

export async function getAllowLan(): Promise<boolean> {
    let b = await store.get(ALLOWLAN_STORE_KEY);
    return Boolean(b);
}

export async function setAllowLan(value: boolean) {
    await store.set(ALLOWLAN_STORE_KEY, value);
    await store.save();
}




/**
 * Retrieves or generates a Clash API secret from the store.
 * 
 * @returns A Promise that resolves to the Clash API secret string.
 * If a secret exists in the store, returns that secret.
 * If no secret exists, generates a new random secret, saves it to the store, and returns it.
 */
export async function getClashApiSecret(): Promise<string> {
    const secret = await store.get(CLASH_API_SECRET);
    if (secret) {
        return secret as string;
    } else {
        // 使用 Web Crypto API 生成随机字节
        const array = new Uint8Array(12);
        crypto.getRandomValues(array);
        const randomSecret = Array.from(array)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
        await store.set(CLASH_API_SECRET, randomSecret);
        await store.save();
        return randomSecret;
    }
}




export async function isBypassRouterEnabled(): Promise<boolean> {
    let b = await store.get(ENABLE_BYPASS_ROUTER_STORE_KEY);
    return Boolean(b);

}

export async function setBypassRouterEnabled(value: boolean) {
    if (OsType !== "macos") {
        toast.error("旁路由模式仅 macOS 支持");
        return;
    }
    await store.set(ENABLE_BYPASS_ROUTER_STORE_KEY, value);
    await store.save();
}


export async function getUseDHCP(): Promise<boolean> {
    let b = await store.get(USE_DHCP_STORE_KEY);
    if (b === undefined) {
        return false;
    }
    return Boolean(b);
}

export async function setUseDHCP(value: boolean) {
    await store.set(USE_DHCP_STORE_KEY, value);
    await store.save();
}

export async function getShowNodeProtocol(): Promise<boolean> {
    let b = await store.get(SHOW_NODE_PROTOCOL_STORE_KEY);
    if (b === undefined) {
        return false;
    }
    return Boolean(b);
}

export async function setShowNodeProtocol(value: boolean) {
    await store.set(SHOW_NODE_PROTOCOL_STORE_KEY, value);
    await store.save();
}

export async function setCustomRuleSet(key: RuleAction, config: RuleSet) {
    await store.set(`custom_ruleset_${key}`, JSON.stringify(config));
    await store.save();
}

// Reads tolerate a missing key (e.g. the reject set on a store written by an
// older build) by returning an empty set — no migration needed.
export async function getCustomRuleSet(key: RuleAction): Promise<RuleSet> {
    let s = await store.get(`custom_ruleset_${key}`) as string | undefined;
    if (s) {
        try {
            const config = JSON.parse(s);
            if (config && typeof config === 'object') {
                if (!Array.isArray(config.domain)) {
                    config.domain = [];
                }
                if (!Array.isArray(config.domain_suffix)) {
                    config.domain_suffix = [];
                }
                if (!Array.isArray(config.ip_cidr)) {
                    config.ip_cidr = [];
                }
                return config
            }

        } catch (e) {
            console.error('解析自定义规则集失败:', e);
        }
    }
    return emptyRuleSet();
}



// set dns for direct connection
export async function setDirectDNS(dnsServers: string) {
    await store.set('direct_dns', dnsServers);
    await store.save();
}

export async function getDirectDNS(): Promise<string> {

    let s = await store.get('direct_dns') as string | undefined;
    if (s) {
        return s;
    }
    let defaultValue = await invoke('get_optimal_local_dns_server') as string;
    console.debug('最佳DNS服务器为:', defaultValue);
    return defaultValue || '223.5.5.5';
}

// 获取用户设置的 User Agent
export async function getUserAgent(): Promise<string> {
    const ua = await store.get(USER_AGENT_STORE_KEY) as string | undefined;
    if (ua) {
        return ua;
    }
    return 'default';
}

// 设置 User Agent
export async function setUserAgent(ua: string) {
    await store.set(USER_AGENT_STORE_KEY, ua);
    await store.save();
}

export async function getProxyPort(): Promise<number> {
    const raw = await store.get(PROXY_PORT_STORE_KEY);
    const port = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isInteger(port) && port > 0 && port <= 65535) {
        return port;
    }
    return DEFAULT_PROXY_PORT;
}

export async function setProxyPort(port: number): Promise<void> {
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error('invalid_proxy_port');
    }
    await store.set(PROXY_PORT_STORE_KEY, port);
    await store.save();
}

export async function getConfigTemplateURLKey(mode: configType): Promise<string> {
    // zh: 返回配置模版 URL 的存储键，格式为 `key-sing-box-{主版本号}-{模式}-template-path`, 如非必要请勿更改此格式。
    // en: Returns the storage key for the config template URL in the format `key-sing-box-{major-version}-{mode}-template-path`. Do not change this format unless necessary.
    const cacheKey = `key-sing-box-${SING_BOX_TEMPLATE_VERSION}-${mode}-template-path`;
    return cacheKey;
}

// 读取模版配置源
export async function getConfigTemplateURL(mode: configType): Promise<string> {
    let defaultTemplatePath = '';
    const cacheKey = await getConfigTemplateURLKey(mode);
    defaultTemplatePath = await getDefaultConfigTemplateURL(mode);
    let configPath = await getStoreValue(cacheKey, defaultTemplatePath);
    console.debug(`Config template path for mode "${mode}": ${configPath}`);
    return configPath;
}

export async function setConfigTemplateURL(mode: configType, url: string) {
    const cacheKey = await getConfigTemplateURLKey(mode);
    await setStoreValue(cacheKey, url);
}

export async function getDefaultConfigTemplateURL(mode: configType): Promise<string> {
    const remoteUrl = "https://onebox-updater.oneoh.cloud/conf-template";
    const buildTimeStage = BUILD_TIME_TEMPLATE_SOURCE.branch;
    if (!isStageVersion(buildTimeStage)) {
        throw new Error(`invalid build-time template branch "${buildTimeStage}"`);
    }
    const storedStage: unknown = await getStoreValue(STAGE_VERSION_STORE_KEY, buildTimeStage);
    const stageVersion: StageVersionType = isStageVersion(storedStage) ? storedStage : buildTimeStage;
    const version = SING_BOX_TEMPLATE_VERSION;

    switch (mode) {
        case 'mixed':
            return `${remoteUrl}/raw/refs/heads/${stageVersion}/conf/${version}/zh-cn/mixed-rules.jsonc`;
        case 'tun':
            return `${remoteUrl}/raw/refs/heads/${stageVersion}/conf/${version}/zh-cn/tun-rules.jsonc`;
        case 'mixed-global':
            return `${remoteUrl}/raw/refs/heads/${stageVersion}/conf/${version}/zh-cn/mixed-global.jsonc`;
        case 'tun-global':
            return `${remoteUrl}/raw/refs/heads/${stageVersion}/conf/${version}/zh-cn/tun-global.jsonc`;
        default:
            return '';
    }
}
