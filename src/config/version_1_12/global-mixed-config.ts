import * as path from '@tauri-apps/api/path';
import { getSubscriptionConfig } from '../../action/db';
import { getAllowLan } from '../../single/store';
import { clashApi } from '../common';
import { updateVPNServerConfigFromDB } from './helper';

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
                "type": "udp",
                "server": "223.6.6.6",
                "server_port": 53,
            },
            {
                "tag": "dns_proxy",
                "type": "tcp",
                "server": "1.0.0.1",
                "detour": "ExitGateway",
            },
            {
                "tag": "system",
                "type": "local",
            },

        ],
        "rules": [
            {
                "query_type": [
                    "HTTPS",
                    "SVCB",
                    "PTR"
                ],
                "action": "reject"
            }

        ],
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

export default async function setGlobalMixedConfig(identifier: string) {
    console.log("写入[全局]系统代理配置文件");
    let dbConfigData = await getSubscriptionConfig(identifier);

    const appConfigPath = await path.appConfigDir();
    const dbCacheFilePath = await path.join(appConfigPath, 'mixed-cache-gloabl-v1.db');
    // 深拷贝配置文件
    const newConfig = JSON.parse(JSON.stringify(mixedConfig));
    newConfig["experimental"]["cache_file"]["path"] = dbCacheFilePath;

    const allowLan = await getAllowLan();

    if (allowLan) {
        newConfig["inbounds"][0]["listen"] = "0.0.0.0";
    } else {
        newConfig["inbounds"][0]["listen"] = "127.0.0.1";
    }
    updateVPNServerConfigFromDB('config.json', dbConfigData, newConfig);


}