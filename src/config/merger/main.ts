import * as path from '@tauri-apps/api/path';
import { getSubscriptionConfig } from '../../action/db';
import { getAllowLan, getClashApiSecret, getCustomRuleSet, getStoreValue, setStoreValue } from '../../single/store';
import { STAGE_VERSION_STORE_KEY } from '../../types/definition';
import { configureMixedInbound, configureTunInbound, updateDHCPSettings2Config, updateVPNServerConfigFromDB } from './helper';

import { configType, getConfigTemplateCacheKey } from '../common';
import { getBuiltInTemplate } from '../templates';


// Cache is the single intermediary. Reads are non-blocking and may return
// stale content — the periodic prime (see hooks/useSwr.ts) refreshes the
// cache in the background. If the cache is empty (first launch, offline),
// fall back to the build-time template snapshot (see src/config/templates)
// and seed the cache so subsequent reads stay fast. No network I/O here.
async function getConfigTemplate(mode: configType): Promise<any> {
    const cacheKey = await getConfigTemplateCacheKey(mode);
    let config = await getStoreValue(cacheKey, '');
    if (!config) {
        config = getBuiltInTemplate(mode);
        await setStoreValue(cacheKey, config);
        console.info(`[template] cache empty for mode=${mode}, seeded built-in snapshot`);
    }
    return JSON.parse(config);
}

async function updateExperimentalConfig(newConfig: any, dbCacheFilePath: string) {

    newConfig["experimental"]["clash_api"] = {
        "external_controller": "127.0.0.1:9191",
        "secret": await getClashApiSecret(),
    };

    newConfig["experimental"]["cache_file"] = {
        "enabled": true,
        "store_fakeip": false,
        "store_rdrc": true,
        "path": dbCacheFilePath
    };

}

export async function setMixedConfig(identifier: string) {
    // 一定要优先深拷贝配置文件，否则会修改原始配置文件对象，导致后续使用时出错。
    const newConfig = await getConfigTemplate('mixed');

    // 根据当前的 Stage 版本设置日志等级
    let level = await getStoreValue(STAGE_VERSION_STORE_KEY) === "dev" ? "debug" : "info";

    newConfig.log.level = level;

    console.log("写入[规则]系统代理配置文件");
    let dbConfigData = await getSubscriptionConfig(identifier);
    const appConfigPath = await path.appConfigDir();
    const dbCacheFilePath = await path.join(appConfigPath, 'mixed-cache-rule-v2.db');

    let directCustomRuleSet = await getCustomRuleSet('direct');
    let proxyCustomRuleSet = await getCustomRuleSet('proxy');


    if (directCustomRuleSet) {
        // 找到包含 direct-tag.oneoh.cloud 的规则的坐标，插入自定义规则
        for (let i = 0; i < newConfig.route.rules.length; i++) {
            let rule = newConfig.route.rules[i];
            if (rule.domain && Array.isArray(rule.domain) && rule.domain.includes('direct-tag.oneoh.cloud')) {
                rule.domain.push(...directCustomRuleSet.domain);
                rule.domain_suffix.push(...directCustomRuleSet.domain_suffix);
                rule.ip_cidr.push(...directCustomRuleSet.ip_cidr);
                break;
            }
        }
    }


    if (proxyCustomRuleSet) {
        for (let i = 0; i < newConfig.route.rules.length; i++) {
            let rule = newConfig.route.rules[i];
            if (rule.domain && Array.isArray(rule.domain) && rule.domain.includes('proxy-tag.oneoh.cloud')) {
                rule.domain.push(...proxyCustomRuleSet.domain);
                rule.domain_suffix.push(...proxyCustomRuleSet.domain_suffix);
                rule.ip_cidr.push(...proxyCustomRuleSet.ip_cidr);
                break;
            }
        }
    }

    updateExperimentalConfig(newConfig, dbCacheFilePath);
    const allowLan = await getAllowLan();
    configureMixedInbound(newConfig, allowLan);

    await updateDHCPSettings2Config(newConfig);
    await updateVPNServerConfigFromDB('config.json', dbConfigData, newConfig);

}

export async function setTunConfig(identifier: string) {
    const newConfig = await getConfigTemplate('tun');

    // 根据当前的 Stage 版本设置日志等级
    let level = await getStoreValue(STAGE_VERSION_STORE_KEY) === "dev" ? "debug" : "info";
    newConfig.log.level = level;
    console.log("写入[规则]TUN代理配置文件");
    let dbConfigData = await getSubscriptionConfig(identifier);
    const appConfigPath = await path.appConfigDir();
    const dbCacheFilePath = await path.join(appConfigPath, 'tun-cache-rule-v2.db');
    let directCustomRuleSet = await getCustomRuleSet('direct');
    let proxyCustomRuleSet = await getCustomRuleSet('proxy');


    if (directCustomRuleSet) {
        // 找到包含 direct-tag.oneoh.cloud 的规则的坐标，插入自定义规则
        for (let i = 0; i < newConfig.route.rules.length; i++) {
            let rule = newConfig.route.rules[i];
            if (rule.domain && Array.isArray(rule.domain) && rule.domain.includes('direct-tag.oneoh.cloud')) {
                rule.domain.push(...directCustomRuleSet.domain);
                rule.domain_suffix.push(...directCustomRuleSet.domain_suffix);
                rule.ip_cidr.push(...directCustomRuleSet.ip_cidr);
                break;
            }

        }
    }


    if (proxyCustomRuleSet) {
        for (let i = 0; i < newConfig.route.rules.length; i++) {
            let rule = newConfig.route.rules[i];
            if (rule.domain && Array.isArray(rule.domain) && rule.domain.includes('proxy-tag.oneoh.cloud')) {
                rule.domain.push(...proxyCustomRuleSet.domain);
                rule.domain_suffix.push(...proxyCustomRuleSet.domain_suffix);
                rule.ip_cidr.push(...proxyCustomRuleSet.ip_cidr);
                break;
            }
        }
    }

    await configureTunInbound(newConfig);

    updateExperimentalConfig(newConfig, dbCacheFilePath);
    const allowLan = await getAllowLan();
    configureMixedInbound(newConfig, allowLan);

    await updateDHCPSettings2Config(newConfig);
    await updateVPNServerConfigFromDB('config.json', dbConfigData, newConfig);
}


export async function setGlobalMixedConfig(identifier: string) {

    const newConfig = await getConfigTemplate('mixed-global');

    // 根据当前的 Stage 版本设置日志等级
    let level = await getStoreValue(STAGE_VERSION_STORE_KEY) === "dev" ? "debug" : "info";
    newConfig.log.level = level;

    console.log("写入[全局]系统代理配置文件");
    let dbConfigData = await getSubscriptionConfig(identifier);
    const appConfigPath = await path.appConfigDir();
    const dbCacheFilePath = await path.join(appConfigPath, 'mixed-cache-global-v2.db');

    updateExperimentalConfig(newConfig, dbCacheFilePath);
    const allowLan = await getAllowLan();
    configureMixedInbound(newConfig, allowLan);

    await updateDHCPSettings2Config(newConfig);
    await updateVPNServerConfigFromDB('config.json', dbConfigData, newConfig);

}



export default async function setGlobalTunConfig(identifier: string) {
    const newConfig = await getConfigTemplate('tun-global');
    // 根据当前的 Stage 版本设置日志等级
    let level = await getStoreValue(STAGE_VERSION_STORE_KEY) === "dev" ? "debug" : "info";
    newConfig.log.level = level;

    console.log("写入[全局]TUN代理配置文件");
    let dbConfigData = await getSubscriptionConfig(identifier);
    const appConfigPath = await path.appConfigDir();
    const dbCacheFilePath = await path.join(appConfigPath, 'tun-cache-global-v2.db');

    await configureTunInbound(newConfig);

    updateExperimentalConfig(newConfig, dbCacheFilePath);

    const allowLan = await getAllowLan();
    configureMixedInbound(newConfig, allowLan);

    await updateDHCPSettings2Config(newConfig);
    await updateVPNServerConfigFromDB('config.json', dbConfigData, newConfig);
}
