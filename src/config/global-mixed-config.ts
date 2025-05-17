import * as path from '@tauri-apps/api/path';
import { getSubscriptionConfig } from '../action/db';
import { getAllowLan } from '../single/store';
import { getSingBoxConfigPath } from '../utils/helper';
import { writeConfigFile } from './helper';

const mixedConfig = {
    "log": {
        "disabled": false,
        "level": "info",
        "timestamp": false
    },
    "dns": {
        "servers": [
            {
                "tag": "alibaba",
                "address": "223.6.6.6",
                "strategy": "ipv4_only",
                "detour": "direct"
            },
            {
                "tag": "dns_proxy",
                //  只有这个 dns 在 sing-box 1.1.* 版本可用, 其余地址会导致 dns 解析失败
                "address": "tcp://1.0.0.1",
                "strategy": "ipv4_only",
                "detour": "流量出口"
            },
            {
                "tag": "system",
                "address": "local",
                "strategy": "ipv4_only",
                "detour": "direct"
            },

        ],
        "rules": [
            {
                "query_type": [
                    "HTTPS",
                    "SVCB"
                ],
                "action": "reject"
            },
            {
                "outbound": "any",
                "server": "alibaba"
            },

        ],
        "strategy": "ipv4_only",
        "final": "dns_proxy"
    },

    "inbounds": [
        {
            "tag": "mixed",
            "type": "mixed",
            "listen": "127.0.0.1",
            "listen_port": 6789,
            "sniff": true,
            "set_system_proxy": false
        }
    ],

    "route": {
        "rules": [
            {
                "inbound": "mixed",
                "action": "resolve"
            },
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
                "ip_is_private": true,
                "outbound": "direct"
            }

        ],
        "final": "流量出口",
        "auto_detect_interface": true,
        "rule_set": [
            {
                "tag": "geoip-cn",
                "type": "remote",
                "format": "binary",
                "url": "https://fastly.jsdelivr.net/gh/SagerNet/sing-geoip@rule-set/geoip-cn.srs",
                "download_detour": "direct"
            },
            {
                "tag": "geosite-cn",
                "type": "remote",
                "format": "binary",
                "url": "https://fastly.jsdelivr.net/gh/OneOhCloud/one-geosite@rules/geosite-one-cn.srs",
                "download_detour": "direct"
            },
            {
                "tag": "geosite-apple",
                "type": "remote",
                "format": "binary",
                "url": "https://fastly.jsdelivr.net/gh/SagerNet/sing-geosite@rule-set/geosite-apple.srs",
                "download_detour": "direct"
            },
            {
                "tag": "geosite-microsoft-cn",
                "type": "remote",
                "format": "binary",
                "url": "https://fastly.jsdelivr.net/gh/SagerNet/sing-geosite@rule-set/geosite-microsoft@cn.srs",
                "download_detour": "direct"
            },
            {
                "tag": "geosite-samsung",
                "type": "remote",
                "format": "binary",
                "url": "https://fastly.jsdelivr.net/gh/SagerNet/sing-geosite@rule-set/geosite-samsung.srs",
                "download_detour": "direct"
            },
            {
                "tag": "geosite-private",
                "type": "remote",
                "format": "binary",
                "url": "https://fastly.jsdelivr.net/gh/SagerNet/sing-geosite@rule-set/geosite-private.srs",
                "download_detour": "direct"
            }
        ]
    },
    "experimental": {
        "clash_api": {
            "external_controller": "127.0.0.1:9191",
        },
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
            "tag": "流量出口",
            "type": "selector",
            "outbounds": [],// 将下面的 {},{},{}  outbounds.tag
            "interrupt_exist_connections": true
        },
        {
            "tag": "自动选择",
            "type": "urltest",
            "outbounds": [] // 将下面的 {},{},{}  outbounds.tag
        }
        // {},{},{} 
    ]
}

export default async function setGlobalMixedConfig(identifier: string) {
    let dbConfigData = await getSubscriptionConfig(identifier);

    const appConfigPath = await path.appConfigDir();
    const dbCacheFilePath = await path.join(appConfigPath, 'cache.db');
    // 深拷贝配置文件
    const newConfig = JSON.parse(JSON.stringify(mixedConfig));
    newConfig["experimental"]["cache_file"]["path"] = dbCacheFilePath;

    const allowLan = await getAllowLan();

    if (allowLan) {
        newConfig["inbounds"][0]["listen"] = "0.0.0.0";
    } else {
        newConfig["inbounds"][0]["listen"] = "127.0.0.1";
    }

    const outbounds = newConfig["outbounds"];
    const outbounds1 = outbounds[1]["outbounds"];
    const outbounds2 = outbounds[2]["outbounds"];

    let selectorNameList = dbConfigData.outbounds.find((item: any) => item.type === "selector").outbounds;



    outbounds1.push(...selectorNameList);


    let serverList = dbConfigData.outbounds.filter((item: any) => {
        return item.type !== "selector" && item.type !== "urltest" && item.type !== "direct" && item.type !== "block";
    });

    const urltestNameList: string[] = [];
    serverList.forEach((item: any) => {
        urltestNameList.push(item.tag);

    })

    outbounds2.push(...urltestNameList);

    outbounds.push(...serverList);



    await writeConfigFile('config.json', new TextEncoder().encode(JSON.stringify(newConfig)));

    const filePath = await getSingBoxConfigPath();
    console.log("配置文件路径:", filePath);
}