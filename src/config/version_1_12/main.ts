import * as path from '@tauri-apps/api/path';
import { getSubscriptionConfig } from '../../action/db';
import { getAllowLan, getClashApiSecret, getCustomRuleSet, getStoreValue } from '../../single/store';
import { STAGE_VERSION_STORE_KEY } from '../../types/definition';
import { configureMixedInbound, configureTunInbound, updateDHCPSettings2Config, updateVPNServerConfigFromDB } from './helper';

import { SING_BOX_VERSION } from '../../types/definition';
import { configType, getConfigTemplateCacheKey } from '../common';
import { getDefaultConfigTemplate } from './zh-cn/config';


async function getConfigTemplate(mode: configType): Promise<any> {

    // 使用缓存机制来解耦配置模板来源
    // 后面可以灵活更换配置模板的存储位置，比如定期从远程服务器/本地文件获取等方式写入缓存
    const cacheKey = await getConfigTemplateCacheKey(mode);
    let config = await getStoreValue(cacheKey, getDefaultConfigTemplate(mode, SING_BOX_VERSION));
    console.debug(`Fetched config template for mode ${mode} from cache key ${cacheKey}`);
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
    const dbCacheFilePath = await path.join(appConfigPath, 'mixed-cache-rule-v1.db');

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
    const dbCacheFilePath = await path.join(appConfigPath, 'tun-cache-rule-v1.db');
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
    const dbCacheFilePath = await path.join(appConfigPath, 'mixed-cache-gloabl-v1.db');

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
    const dbCacheFilePath = await path.join(appConfigPath, 'tun-cache-global-v1.db');

    await configureTunInbound(newConfig);

    updateExperimentalConfig(newConfig, dbCacheFilePath);

    const allowLan = await getAllowLan();
    configureMixedInbound(newConfig, allowLan);

    await updateDHCPSettings2Config(newConfig);
    await updateVPNServerConfigFromDB('config.json', dbConfigData, newConfig);
}
