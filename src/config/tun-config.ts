import * as path from '@tauri-apps/api/path';
import { BaseDirectory, create } from '@tauri-apps/plugin-fs';
import { type } from '@tauri-apps/plugin-os';
import { getSubscriptionConfig } from '../action/db';
import { getAllowLan } from '../single/store';
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
                "rule_set": [
                    "geosite-telegram"
                ],
                "server": "remote"
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
                    ".msftconnecttest.com",
                    ".wiwide.net",
                    "connectivitycheck.android.com",
                    "detectportal.firefox.com",
                    "nmcheck.gnome.org",
                    "router.asus.com",
                    "wiportal.wiwide.com",
                    "www.miwifi.com"
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
            "platform": {
                "http_proxy": {
                    "enabled": false,
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
            "sniff": true,
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


    //  Windows 使用 system stack 兼容性是最佳的。
    if (type() === "windows" || type() === "linux") {
        tunConfig.inbounds[0].stack = "system";
    }

    // 其余平台使用 gvisor stack 避免潜在问题
    // 比如在 macOS 上使用 system stack 时会导致诸多问题，需要追踪 sing-box 是否解决此问题。

    // 深拷贝配置文件
    const newConfig = JSON.parse(JSON.stringify(tunConfig));

    const allowLan = await getAllowLan();
    if (allowLan) {
        newConfig["inbounds"][1]["listen"] = "0.0.0.0";
    } else {
        newConfig["inbounds"][1]["listen"] = "127.0.0.1";
    }





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

  const file = await create('config.json', { baseDir: BaseDirectory.AppConfig });
    await file.write(new TextEncoder().encode(JSON.stringify(newConfig)));
    await file.close();

    // open file
    const filePath = await getSingBoxConfigPath();
    console.log("配置文件路径:", filePath);
}