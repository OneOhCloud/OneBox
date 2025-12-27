import * as path from '@tauri-apps/api/path';
import { getSubscriptionConfig } from '../../action/db';
import { getAllowLan, getClashApiSecret, getCustomRuleSet, getStoreValue } from '../../single/store';
import { STAGE_VERSION_STORE_KEY } from '../../types/definition';
import { updateDHCPSettings2Config, updateVPNServerConfigFromDB } from './helper';

import { type } from '@tauri-apps/plugin-os';
import { SING_BOX_VERSION, TUN_STACK_STORE_KEY } from '../../types/definition';
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

    if (allowLan) {
        newConfig["inbounds"][0]["listen"] = "0.0.0.0";
    } else {
        newConfig["inbounds"][0]["listen"] = "127.0.0.1";
    }

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



    // Windows 使用 system stack 兼容性是最佳的。（弃用！！！）
    // if (type() === "windows" || type() === "linux") {
    //     newConfig.inbounds[0].stack = "system";
    // }

    // 2025年8月17日经过测试，
    // 在 sing-box 1.12.1 内核中
    // 使用 system 栈节点延迟比 gvisor 高
    // 所以使用在 macOS 和 Windows 系统中使用默认值（gVisor），
    // linux 中默认使用 system 栈，除非有实际证据表明性能也不如 gVisor。

    if (type() === "linux") {
        newConfig.inbounds[0].stack = "system";
    }

    // 如果用户在设置中选择了 TUN Stack，则使用用户选择的 stack
    // macOS 强制默认使用 gvisor stack，因为经过测试 system stack 无法正常运作。
    if (type() !== "macos" && await getStoreValue(TUN_STACK_STORE_KEY)) {
        newConfig.inbounds[0].stack = await getStoreValue(TUN_STACK_STORE_KEY);
    }

    console.log("当前 TUN Stack:", newConfig.inbounds[0].stack);
    updateExperimentalConfig(newConfig, dbCacheFilePath); const allowLan = await getAllowLan();

    if (allowLan) {
        newConfig["inbounds"][1]["listen"] = "0.0.0.0";
    } else {
        newConfig["inbounds"][1]["listen"] = "127.0.0.1";
    }

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

    if (allowLan) {
        newConfig["inbounds"][0]["listen"] = "0.0.0.0";
    } else {
        newConfig["inbounds"][0]["listen"] = "127.0.0.1";
    }

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

    // Windows 使用 system stack 兼容性是最佳的。（弃用！！！）
    // if (type() === "windows" || type() === "linux") {
    //     newConfig.inbounds[0].stack = "system";
    // }

    // 2025年8月17日经过测试，
    // 在 sing-box 1.12.1 内核中
    // 使用 system 栈节点延迟比 gvisor 高
    // 所以使用在 macOS 和 Windows 系统中使用默认值（gVisor），
    // linux 中默认使用 system 栈，除非有实际证据表明性能也不如 gVisor。

    if (type() === "linux") {
        newConfig.inbounds[0].stack = "system";
    }

    // 如果用户在设置中选择了 TUN Stack，则使用用户选择的 stack
    // macOS 强制默认使用 gvisor stack，因为经过测试 system stack 无法正常运作。
    if (type() !== "macos" && await getStoreValue(TUN_STACK_STORE_KEY)) {
        newConfig.inbounds[0].stack = await getStoreValue(TUN_STACK_STORE_KEY);
    }

    console.log("当前 TUN Stack:", newConfig.inbounds[0].stack);

    updateExperimentalConfig(newConfig, dbCacheFilePath);

    const allowLan = await getAllowLan();
    if (allowLan) {
        newConfig["inbounds"][1]["listen"] = "0.0.0.0";
    } else {
        newConfig["inbounds"][1]["listen"] = "127.0.0.1";
    }

    await updateDHCPSettings2Config(newConfig);
    await updateVPNServerConfigFromDB('config.json', dbConfigData, newConfig);
}