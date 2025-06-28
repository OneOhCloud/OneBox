import * as path from '@tauri-apps/api/path';
import { getSubscriptionConfig } from '../../action/db';
import { getAllowLan } from '../../single/store';
import { clashApi, ruleSet } from '../common';
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
        "address": "223.6.6.6",
        "strategy": "ipv4_only",
        "detour": "direct"
      },
      {
        "tag": "dns_proxy",
        //  只有这个 dns 在 sing-box 1.1.* 版本可用, 其余地址会导致 dns 解析失败
        "address": "tcp://1.0.0.1",
        "strategy": "ipv4_only",
        "detour": "ExitGateway"
      },
      {
        "tag": "system",
        "address": "local",
        "strategy": "ipv4_only",
        "detour": "direct"
      },
      {
        "tag": "tencent",
        "address": "119.29.29.29",
        "strategy": "ipv4_only",
        "detour": "direct"
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
        "domain_suffix": [
          ".github.com",
        ],
        "server": "dns_proxy"
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
    "strategy": "ipv4_only",
    "final": "system"
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





export default async function setMixedConfig(identifier: string) {
  console.log("写入[规则]系统代理配置文件");

  let dbConfigData = await getSubscriptionConfig(identifier);

  const appConfigPath = await path.appConfigDir();
  const dbCacheFilePath = await path.join(appConfigPath, 'mixed-cache-rule--v1.db');

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