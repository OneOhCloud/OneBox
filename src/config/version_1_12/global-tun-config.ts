import * as path from '@tauri-apps/api/path';
import { type } from '@tauri-apps/plugin-os';
import { getSubscriptionConfig } from '../../action/db';
import { getAllowLan, getStoreValue } from '../../single/store';
import { TUN_STACK_STORE_KEY } from '../../types/definition';
import { clashApi, ruleSet } from '../common';
import { updateVPNServerConfigFromDB } from './helper';


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
                "type": "local",
            },
            {
                "type": "quic",
                "tag": "alibaba_quic_dns",
                "server": "223.6.6.6",
                "server_port": 853,
            },
            {
                "tag": "dns_proxy",
                //  只有这个 dns 在 sing-box 1.1.* 版本可用, 其余地址会导致 dns 解析失败
                "type": "tcp",
                "server": "1.0.0.1",
                "detour": "ExitGateway",

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
                "query_type": [
                    "A",
                    "AAAA",
                    "CNAME"
                ],
                "server": "remote"
            }
        ],
        "strategy": "prefer_ipv4",
        "final": "dns_proxy"
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
                "ff05::/16"
            ]
        },

        {
            "tag": "mixed",
            "type": "mixed",
            "listen": "127.0.0.1",
            "listen_port": 6789,
            "sniff": true,
            "reuse_addr": true,
            "tcp_fast_open": true,
            "set_system_proxy": false
        }
    ],
    "route": {
        "rules": [

            {
                "inbound": "tun",
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
                "domain_suffix": [
                    "local",
                    "lan",
                    "localdomain",
                    "localhost",
                    "bypass.local",
                    "captive.apple.com",
                ],
                "ip_is_private": true,
                "outbound": "direct"
            }

        ],
        "final": "ExitGateway",
        "auto_detect_interface": true,
        "rule_set": ruleSet

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
            "type": "direct"
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
            "outbounds": []
        }
    ]
}

export default async function setGlobalTunConfig(identifier: string) {
    console.log("写入[全局]TUN代理配置文件");

    let dbConfigData = await getSubscriptionConfig(identifier);

    const appConfigPath = await path.appConfigDir();
    const dbCacheFilePath = await path.join(appConfigPath, 'tun-cache-global-v1.db');

    //  Windows 使用 system stack 兼容性是最佳的。
    if (type() === "windows" || type() === "linux") {
        tunConfig.inbounds[0].stack = "system";
    }
    // 如果用户在设置中选择了 TUN Stack，则使用用户选择的 stack
    // 苹果系统默认使用 gvisor stack
    if (type() !== "macos" && await getStoreValue(TUN_STACK_STORE_KEY)) {
        tunConfig.inbounds[0].stack = await getStoreValue(TUN_STACK_STORE_KEY);
    }

    console.log("当前 TUN Stack:", tunConfig.inbounds[0].stack);


    // 深拷贝配置文件
    const newConfig = JSON.parse(JSON.stringify(tunConfig));
    newConfig["experimental"]["cache_file"]["path"] = dbCacheFilePath;

    const allowLan = await getAllowLan();
    if (allowLan) {
        newConfig["inbounds"][1]["listen"] = "0.0.0.0";
    } else {
        newConfig["inbounds"][1]["listen"] = "127.0.0.1";
    }
    updateVPNServerConfigFromDB('config.json', dbConfigData, newConfig);
}