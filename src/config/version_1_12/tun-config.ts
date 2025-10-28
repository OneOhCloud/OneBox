import * as path from '@tauri-apps/api/path';
import { type } from '@tauri-apps/plugin-os';
import { getSubscriptionConfig } from '../../action/db';
import { getAllowLan, getCustomRuleSet, getStoreValue } from '../../single/store';
import { STAGE_VERSION_STORE_KEY, TUN_STACK_STORE_KEY } from '../../types/definition';
import { clashApi, DEFAULT_SYSTEM_DNS, ruleSet } from '../common';
import { updateDHCPSettings2Config, updateVPNServerConfigFromDB } from './helper';

const tunConfig = {
    "log": {
        "disabled": false,
        "level": "info",
        "timestamp": false
    },
    "dns": {
        "servers": [
            {
                "tag": "system",
                "type": "udp",
                "server": DEFAULT_SYSTEM_DNS,
                "server_port": 53,
                "connect_timeout": "5s",


            },
            {
                "tag": "dns_proxy",
                "type": "tcp",
                "server": "1.0.0.1",
                "detour": "ExitGateway",
                "connect_timeout": "5s",

            },
            {
                "tag": "remote",
                "type": "fakeip",
                "inet4_range": "198.18.0.0/15",
                "inet6_range": "fc00::/18"
            }
        ],
        "rules": [
            {
                "query_type": [
                    "HTTPS",
                    "SVCB",
                    "PTR"
                ],
                "action": "reject"
            },
            {
                "domain": [
                    "captive.oneoh.cloud",
                    "captive.apple.com",
                    "nmcheck.gnome.org",
                    "www.msftconnecttest.com",
                    "connectivitycheck.gstatic.com",
                ],
                "rule_set": [
                    "geoip-cn",
                    "geosite-cn",
                    "geosite-apple",
                    "geosite-microsoft-cn",
                    "geosite-samsung",
                    "geosite-private"
                ],
                "disable_cache": true,
                "strategy": "prefer_ipv4",
                "server": "system"

            },
            {
                "query_type": [
                    "A",
                    "AAAA",
                    "CNAME"
                ],
                "server": "remote",
                "strategy": "prefer_ipv4"

            }
        ],
        "final": "dns_proxy",
        "strategy": "prefer_ipv4"

    },
    "inbounds": [
        {
            "tag": "tun",
            "type": "tun",
            "address": [
                "172.19.0.1/30",
                "fdfe:dcba:9876::1/126"
            ],
            "platform": {
                "http_proxy": {
                    "enabled": true,
                    "server": "127.0.0.1",
                    "server_port": 6789,

                }
            },
            "mtu": 9000,
            "stack": "gvisor",
            "auto_route": true,
            "strict_route": true,
            "sniff": true,
            "sniff_override_destination": true,
            "route_exclude_address": [
                "10.0.0.0/8",
                "100.64.0.0/10",
                "127.0.0.0/8",
                "169.254.0.0/16",
                "172.16.0.0/12",
                "192.0.0.0/24",
                "192.168.0.0/16",
                "224.0.0.0/4",
                "240.0.0.0/4",
                "255.255.255.255/32",
                "fe80::/10",
                "fc00::/7",
                "ff01::/16",
                "ff02::/16",
                "ff03::/16",
                "ff04::/16",
                "ff05::/16",
                "240e::/20",
            ]
        },
        {
            "tag": "mixed",
            "type": "mixed",
            "listen": "127.0.0.1",
            "listen_port": 6789,
            "reuse_addr": true,
            "tcp_fast_open": true,
            "set_system_proxy": false,
        }
    ],
    "route": {
        "rules": [
            {
                "inbound": "mixed",
                "action": "sniff"
            },
            {
                "protocol": "dns",
                "action": "hijack-dns"
            },
            {
                "protocol": "quic",
                "action": "reject"
            },
            {
                "domain": [
                    "direct-tag.oneoh.cloud"
                ],
                "domain_suffix": [],
                "ip_cidr": [],
                "outbound": "direct"

            },

            {
                "domain": [
                    "proxy-tag.oneoh.cloud"
                ],
                "domain_suffix": [],
                "ip_cidr": [],
                "outbound": "ExitGateway"
            },


            {
                "domain": [
                    "captive.oneoh.cloud",
                    "captive.apple.com",
                    "nmcheck.gnome.org",
                    "www.msftconnecttest.com",
                    "connectivitycheck.gstatic.com",
                ],
                "domain_suffix": [
                    "local",
                    "lan",
                    "localdomain",
                    "localhost",
                    "bypass.local",
                    "captive.apple.com"
                ],
                "rule_set": [
                    "geoip-cn",
                    "geosite-cn",
                    "geosite-apple",
                    "geosite-microsoft-cn",
                    "geosite-samsung",
                    "geosite-private"
                ],
                "ip_is_private": true,
                "outbound": "direct"
            }
        ],
        "final": "ExitGateway",
        "rule_set": ruleSet,
        "auto_detect_interface": true

    },
    "experimental": {
        "clash_api": clashApi,
        "cache_file": {
            "enabled": true,
            "store_fakeip": false,
            "store_rdrc": true
        }
    },
    "outbounds": [
        {
            "tag": "direct",
            "type": "direct",
            "domain_resolver": "system"

        },
        {
            "tag": "ExitGateway",
            "type": "selector",
            "outbounds": ["auto"],
            "interrupt_exist_connections": true
        },
        {
            "tag": "auto",
            "type": "urltest",
            "url": "https://www.google.com/generate_204",
            "outbounds": []
        }
    ]
}

export default async function setTunConfig(identifier: string) {
    // 一定要优先深拷贝配置文件，否则会修改原始配置文件对象，导致后续使用时出错。
    const newConfig = JSON.parse(JSON.stringify(tunConfig));

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
    newConfig["experimental"]["cache_file"]["path"] = dbCacheFilePath;
    const allowLan = await getAllowLan();
    if (allowLan) {
        newConfig["inbounds"][1]["listen"] = "0.0.0.0";
    } else {
        newConfig["inbounds"][1]["listen"] = "127.0.0.1";
    }

    await updateDHCPSettings2Config(newConfig);
    await updateVPNServerConfigFromDB('config.json', dbConfigData, newConfig);
}