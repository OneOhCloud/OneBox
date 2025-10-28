import * as path from '@tauri-apps/api/path';
import { getSubscriptionConfig } from '../../action/db';
import { getAllowLan, getCustomRuleSet, getStoreValue } from '../../single/store';
import { STAGE_VERSION_STORE_KEY } from '../../types/definition';
import { clashApi, DEFAULT_SYSTEM_DNS, ruleSet } from '../common';
import { updateDHCPSettings2Config, updateVPNServerConfigFromDB } from './helper';

const mixedConfig = {
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
        "server_port": 53,
        "detour": "ExitGateway",
        "connect_timeout": "5s",

      },
      {
        "tag": "alibaba",
        "type": "udp",
        "server": "223.6.6.6",
        "server_port": 53,
        "connect_timeout": "5s",

      },
      {
        "tag": "tencent",
        "type": "udp",
        "server": "119.29.29.29",
        "server_port": 53,
        "connect_timeout": "5s",

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
        "disable_cache": true,
        "strategy": "prefer_ipv4",
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
    "strategy": "prefer_ipv4",
    "final": "system"
  },

  "inbounds": [
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
        "action": "sniff"
      },

      {
        "type": "logical",
        "mode": "or",
        "rules": [
          {
            "protocol": "dns"
          },
          {
            "port": 53
          }
        ],
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
          "www.msftconnecttest.com"
        ],
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
    "rule_set": ruleSet,
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



export default async function setMixedConfig(identifier: string) {
  // 一定要优先深拷贝配置文件，否则会修改原始配置文件对象，导致后续使用时出错。
  const newConfig = JSON.parse(JSON.stringify(mixedConfig));

  // 根据当前的 Stage 版本设置日志等级
  let level = await getStoreValue(STAGE_VERSION_STORE_KEY) === "dev" ? "debug" : "info";
  newConfig.log.level = level;

  console.log("写入[规则]系统代理配置文件");
  let dbConfigData = await getSubscriptionConfig(identifier);
  const appConfigPath = await path.appConfigDir();
  const dbCacheFilePath = await path.join(appConfigPath, 'mixed-cache-rule--v1.db');

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



  newConfig["experimental"]["cache_file"]["path"] = dbCacheFilePath;
  const allowLan = await getAllowLan();

  if (allowLan) {
    newConfig["inbounds"][0]["listen"] = "0.0.0.0";
  } else {
    newConfig["inbounds"][0]["listen"] = "127.0.0.1";
  }

  await updateDHCPSettings2Config(newConfig);
  await updateVPNServerConfigFromDB('config.json', dbConfigData, newConfig);

}