import * as path from '@tauri-apps/api/path';
import { create, BaseDirectory } from '@tauri-apps/plugin-fs';
import { getSubscriptionConfig } from '../action/db';
import { getSingBoxConfigPath } from '../utils/helper';


const tunConfig = {
    "log": {
        "disabled": false,
        "level": "info",
        "timestamp": false
    },
    "dns": {
        "servers": [
            {
                "tag": "dns_proxy",
                "address": "8.8.8.8",
                "client_subnet": "114.114.114.114/24",
                "strategy": "ipv4_only",
                "detour": "流量出口"
            },
            {
                "tag": "system",
                "address": "local",
                "strategy": "ipv4_only",
                "detour": "direct"
            },
            {
                "tag": "alibaba",
                "address": "223.6.6.6",
                "strategy": "ipv4_only",
                "detour": "direct"
            },
            {
                "tag": "tencent",
                "address": "119.29.29.29",
                "strategy": "ipv4_only",
                "detour": "direct"
            },
            {
                "tag": "remote",
                "address": "fakeip"
            }
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
            {
                "clash_mode": "直连",
                "server": "system"
            },
            {
                "clash_mode": "全局",
                "server": "remote"
            },
            {
                "domain_suffix": [
                    ".oneoh.cloud",
                    ".n2ray.dev",
                    ".ksjhaoka.com",
                    ".mixcapp.com",
                    ".wiwide.net",
                    "wiportal.wiwide.com",
                    ".msftconnecttest.com",
                    "nmcheck.gnome.org",
                    "detectportal.firefox.com",
                    "connectivitycheck.android.com",
                    "www.miwifi.com",
                    "router.asus.com"
                ],
                "rule_set": [
                    "geoip-cn",
                    "geosite-cn",
                    "geosite-apple",
                    "geosite-microsoft-cn",
                    "geosite-samsung",
                    "geosite-private"
                ],
                "server": "system"
            },
            {
                "query_type": [
                    "A",
                    "AAAA",
                    "CNAME"
                ],
                "server": "remote"
            },
            {
                "rule_set": [
                    "geoip-cn",
                    "geosite-cn",
                    "geosite-apple",
                    "geosite-microsoft-cn",
                    "geosite-samsung",
                    "geosite-private"
                ],
                "invert": true,
                "server": "dns_proxy"
            }
        ],
        "fakeip": {
            "enabled": true,
            "inet4_range": "198.18.0.0/15",
            "inet6_range": "fc00::/18"
        },
        "strategy": "ipv4_only",
        "final": "system"
    },
    "inbounds": [
        {
            "tag": "tun",
            "type": "tun",
            "address": [
                "172.19.0.1/30",
                "fdfe:dcba:9876::1/126"
            ],
            "mtu": 9000,
            "stack": "gvisor",
            "auto_route": true,
            "strict_route": true,
            "sniff": true,
            "sniff_override_destination": true,
            "platform": {
                "http_proxy": {
                    "enabled": false,
                    "server": "127.0.0.1",
                    "server_port": 5678
                }
            },
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
            "listen_port": 5678,
            "sniff": true,
            "set_system_proxy": false
        }
    ],
    "route": {
        "rules": [
            {
                "inbound": [
                    "mixed"
                ],
                "action": "resolve"
            },
            {
                "inbound": [
                    "mixed",
                    "tun"
                ],
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
                "clash_mode": "直连",
                "outbound": "direct"
            },
            {
                "clash_mode": "全局",
                "outbound": "流量出口"
            },
            {
                "ip_is_private": true,
                "outbound": "direct"
            },
            {
                "domain_suffix": [
                    ".oneoh.cloud",
                    ".n2ray.dev",
                    ".ksjhaoka.com",
                    ".mixcapp.com"
                ],
                "rule_set": [
                    "geoip-cn",
                    "geosite-cn",
                    "geosite-apple",
                    "geosite-microsoft-cn",
                    "geosite-samsung",
                    "geosite-private"
                ],
                "outbound": "流量出口",
                "invert": true
            }
        ],
        "final": "direct",
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
            },
            {
                "tag": "geosite-telegram",
                "type": "remote",
                "format": "binary",
                "url": "https://fastly.jsdelivr.net/gh/SagerNet/sing-geosite@rule-set/geosite-telegram.srs",
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

export default async function setTunConfig(identifier: string) {
    let dbConfigData = await getSubscriptionConfig(identifier);

    const appConfigPath = await path.appConfigDir();
    const dbCacheFilePath = await path.join(appConfigPath, 'tun-cache.db');
    const newConfig = JSON.parse(JSON.stringify(tunConfig));
    newConfig["experimental"]["cache_file"]["path"] = dbCacheFilePath;

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

    const file = await create('config.json', { baseDir: BaseDirectory.AppData });
    await file.write(new TextEncoder().encode(JSON.stringify(newConfig)));
    await file.close();

    // open file
    const filePath = await getSingBoxConfigPath();
    console.log("配置文件路径:", filePath);
}