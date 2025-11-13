import { configType } from "../../common"

const mixedRulesConfig = {
    "log": {
        "disabled": false,
        "level": "debug",
        "timestamp": false
    },
    "dns": {
        "servers": [
            {
                "tag": "system", // 🚫 禁止修改 tag 名称
                "type": "udp",
                "server": "119.29.29.29",
                "server_port": 53,
                "connect_timeout": "5s"
            },
            {
                "tag": "dns_proxy", // 🚫 禁止修改 tag 名称
                "type": "tcp",
                "server": "1.0.0.1",
                "server_port": 53,
                "detour": "ExitGateway",
                "connect_timeout": "5s"
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
                "rule_set": [
                    "geosite-linkedin",
                    "geosite-linkedin-cn"
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
                    "captive.apple.com",
                    "detectportal.firefox.com",
                    "connectivitycheck.android.com",
                    "connectivitycheck.gstatic.com",
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
        "final": "system" // 🚫 禁止修改
    },
    "inbounds": [
        {
            "tag": "mixed",
            "type": "mixed",
            "listen": "127.0.0.1",
            "listen_port": 6789, // 🚫 禁止修改
            "reuse_addr": true,
            "tcp_fast_open": true,
            "set_system_proxy": false // 🚫 禁止修改
        }
    ],
    "route": {
        "rules": [
            // 不可更改区域开始
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
            // 不可更改区域结束
            {
                "rule_set": [
                    "geosite-linkedin",
                    "geosite-linkedin-cn"
                ],
                "outbound": "ExitGateway"
            },
            {
                "domain": [
                    "captive.oneoh.cloud",
                    "captive.apple.com",
                    "nmcheck.gnome.org",
                    "www.msftconnecttest.com",
                    "connectivitycheck.gstatic.com"
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
        "final": "ExitGateway", // 🚫 禁止修改
        "auto_detect_interface": true,
        "rule_set": [
            {
                "tag": "geoip-cn",
                "type": "remote",
                "format": "binary",
                "url": "https://jsdelivr.oneoh.cloud/gh/MetaCubeX/meta-rules-dat@sing/geo/geoip/cn.srs"
            },
            {
                "type": "remote",
                "tag": "geosite-geolocation-cn",
                "format": "source",
                "url": "https://jsdelivr.oneoh.cloud/gh/MetaCubeX/meta-rules-dat@sing/geo/geosite/geolocation-cn.json"
            },
            {
                "tag": "geosite-linkedin",
                "type": "remote",
                "format": "binary",
                "url": "https://jsdelivr.oneoh.cloud/gh/SagerNet/sing-geosite@rule-set/geosite-linkedin.srs"
            },
            {
                "tag": "geosite-linkedin-cn",
                "type": "remote",
                "format": "binary",
                "url": "https://jsdelivr.oneoh.cloud/gh/SagerNet/sing-geosite@rule-set/geosite-linkedin@cn.srs"
            },
            {
                "type": "remote",
                "tag": "geosite-geolocation-!cn",
                "format": "source",
                "url": "https://jsdelivr.oneoh.cloud/gh/MetaCubeX/meta-rules-dat@sing/geo/geosite/geolocation-!cn.json"
            },
            {
                "tag": "geosite-cn",
                "type": "remote",
                "format": "binary",
                "url": "https://jsdelivr.oneoh.cloud/gh/OneOhCloud/one-geosite@rules/geosite-one-cn.srs"
            },
            {
                "tag": "geosite-apple",
                "type": "remote",
                "format": "binary",
                "url": "https://jsdelivr.oneoh.cloud/gh/SagerNet/sing-geosite@rule-set/geosite-apple.srs"
            },
            {
                "tag": "geosite-microsoft-cn",
                "type": "remote",
                "format": "binary",
                "url": "https://jsdelivr.oneoh.cloud/gh/SagerNet/sing-geosite@rule-set/geosite-microsoft@cn.srs"
            },
            {
                "tag": "geosite-samsung",
                "type": "remote",
                "format": "binary",
                "url": "https://jsdelivr.oneoh.cloud/gh/SagerNet/sing-geosite@rule-set/geosite-samsung.srs"
            },
            {
                "tag": "geosite-telegram",
                "type": "remote",
                "format": "binary",
                "url": "https://jsdelivr.oneoh.cloud/gh/SagerNet/sing-geosite@rule-set/geosite-telegram.srs"
            },
            {
                "tag": "geosite-private",
                "type": "remote",
                "format": "binary",
                "url": "https://jsdelivr.oneoh.cloud/gh/SagerNet/sing-geosite@rule-set/geosite-private.srs"
            }
        ]
    },
    "experimental": {
        "clash_api": {}, // 此字段将被忽略
        "cache_file": {} // 此字段将被忽略
    },
    // ------------------ Outbounds ------------------
    // OneBox 会自动追加远程配置或者本地配置内容中的服务节点
    // 到 outbounds 以及 ExitGateway["outbounds"] 和 auto["outbounds"] 中
    // 如果需要添加自定义的出站，可以在此处添加，但请不要有重复的 tag 名称以及修改以下三个出站的 tag 名称
    // 记住一个修改原则：只追加，不修改，不删除，不重复
    "outbounds": [
        {
            "tag": "direct",
            "type": "direct",
            "domain_resolver": "system"
        },
        {
            "tag": "ExitGateway",
            "type": "selector",
            "outbounds": [
                "auto"
            ],
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
const miexdGlobalConfig = {
    "log": {
        "disabled": false,
        "level": "debug",
        "timestamp": false
    },
    "dns": {
        "servers": [
            {
                "tag": "system", // 🚫 禁止修改 tag 名称
                "type": "udp",
                "server": "119.29.29.29",
                "server_port": 53,
                "connect_timeout": "5s"
            },
            {
                "tag": "dns_proxy", // 🚫 禁止修改 tag 名称
                "type": "tcp",
                "server": "1.0.0.1",
                "detour": "ExitGateway",
                "connect_timeout": "5s"
            }
        ],
        "rules": [
            {
                "domain": [
                    "captive.oneoh.cloud",
                    "captive.apple.com",
                    "nmcheck.gnome.org",
                    "www.msftconnecttest.com",
                    "connectivitycheck.gstatic.com"
                ],
                "server": "system",
                "strategy": "prefer_ipv4"
            },
            {
                "query_type": [
                    "HTTPS",
                    "SVCB",
                    "PTR"
                ],
                "action": "reject"
            }
        ],
        "strategy": "prefer_ipv4",
        "final": "dns_proxy" // 🚫 禁止修改 
    },
    "inbounds": [
        {
            "tag": "mixed", // 🚫 禁止修改 tag 名称
            "type": "mixed",
            "listen": "127.0.0.1",
            "listen_port": 6789, // 🚫 禁止修改 
            "reuse_addr": true,
            "tcp_fast_open": true,
            "set_system_proxy": false // 🚫 禁止修改 
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
                "domain": [
                    "captive.oneoh.cloud",
                    "captive.apple.com",
                    "nmcheck.gnome.org",
                    "www.msftconnecttest.com",
                    "connectivitycheck.gstatic.com"
                ],
                "domain_suffix": [
                    "local",
                    "lan",
                    "localdomain",
                    "localhost",
                    "bypass.local",
                    "captive.apple.com"
                ],
                "ip_is_private": true,
                "outbound": "direct"
            }
        ],
        "final": "ExitGateway", // 🚫 禁止修改
        "auto_detect_interface": true
    },
    "experimental": {
        "clash_api": {}, // 此字段将被忽略
        "cache_file": {} // 此字段将被忽略
    },
    // ------------------ Outbounds ------------------
    // OneBox 会自动追加远程配置或者本地配置内容中的服务节点
    // 到 outbounds 以及 ExitGateway["outbounds"] 和 auto["outbounds"] 中
    // 如果需要添加自定义的出站，可以在此处添加，但请不要有重复的 tag 名称以及修改以下三个出站的 tag 名称
    // 记住一个修改原则：只追加，不修改，不删除，不重复
    "outbounds": [
        {
            "tag": "direct",
            "type": "direct",
            "domain_resolver": "system"
        },
        {
            "tag": "ExitGateway",
            "type": "selector",
            "outbounds": [
                "auto"
            ],
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

const TunRulesConfig = {
    "log": {
        "disabled": false,
        "level": "debug",
        "timestamp": false
    },
    "dns": {
        "servers": [
            {
                "tag": "system", // 🚫 禁止修改 tag 名称
                "type": "udp",
                "server": "119.29.29.29",
                "server_port": 53,
                "connect_timeout": "5s"
            },
            {
                "tag": "dns_proxy", // 🚫 禁止修改 tag 名称
                "type": "tcp",
                "server": "1.0.0.1",
                "detour": "ExitGateway",
                "connect_timeout": "5s"
            },
            {
                "tag": "remote", // 🚫 禁止修改 tag 名称
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
                "rule_set": [
                    "geosite-linkedin",
                    "geosite-linkedin-cn"
                ],
                "server": "remote"
            },
            {
                "domain": [
                    "captive.oneoh.cloud",
                    "captive.apple.com",
                    "nmcheck.gnome.org",
                    "www.msftconnecttest.com",
                    "connectivitycheck.gstatic.com"
                ],
                "rule_set": [
                    "geoip-cn",
                    "geosite-cn",
                    "geosite-apple",
                    "geosite-microsoft-cn",
                    "geosite-samsung",
                    "geosite-private"
                ],
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
                    "enabled": true, // 🚫 禁止修改 
                    "server": "127.0.0.1",
                    "server_port": 6789 // 🚫 禁止修改 
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
                "240e::/20"
            ]
        },
        {
            "tag": "mixed", // 🚫 禁止修改 tag 名称
            "type": "mixed",
            "listen": "127.0.0.1",
            "listen_port": 6789, // 🚫 禁止修改
            "reuse_addr": true,
            "tcp_fast_open": true,
            "set_system_proxy": false // 🚫 禁止修改
        }
    ],
    "route": {
        "rules": [
            // 不可更改区域开始
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
            // 不可更改区域结束
            {
                "rule_set": [
                    "geosite-linkedin",
                    "geosite-linkedin-cn"
                ],
                "outbound": "ExitGateway"
            },
            {
                "domain": [
                    "captive.oneoh.cloud",
                    "captive.apple.com",
                    "nmcheck.gnome.org",
                    "www.msftconnecttest.com",
                    "connectivitycheck.gstatic.com"
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
        "final": "ExitGateway", // 🚫 禁止修改 
        "rule_set": [
            {
                "tag": "geoip-cn",
                "type": "remote",
                "format": "binary",
                "url": "https://jsdelivr.oneoh.cloud/gh/MetaCubeX/meta-rules-dat@sing/geo/geoip/cn.srs"
            },
            {
                "type": "remote",
                "tag": "geosite-geolocation-cn",
                "format": "source",
                "url": "https://jsdelivr.oneoh.cloud/gh/MetaCubeX/meta-rules-dat@sing/geo/geosite/geolocation-cn.json"
            },
            {
                "tag": "geosite-linkedin",
                "type": "remote",
                "format": "binary",
                "url": "https://jsdelivr.oneoh.cloud/gh/SagerNet/sing-geosite@rule-set/geosite-linkedin.srs"
            },
            {
                "tag": "geosite-linkedin-cn",
                "type": "remote",
                "format": "binary",
                "url": "https://jsdelivr.oneoh.cloud/gh/SagerNet/sing-geosite@rule-set/geosite-linkedin@cn.srs"
            },
            {
                "type": "remote",
                "tag": "geosite-geolocation-!cn",
                "format": "source",
                "url": "https://jsdelivr.oneoh.cloud/gh/MetaCubeX/meta-rules-dat@sing/geo/geosite/geolocation-!cn.json"
            },
            {
                "tag": "geosite-cn",
                "type": "remote",
                "format": "binary",
                "url": "https://jsdelivr.oneoh.cloud/gh/OneOhCloud/one-geosite@rules/geosite-one-cn.srs"
            },
            {
                "tag": "geosite-apple",
                "type": "remote",
                "format": "binary",
                "url": "https://jsdelivr.oneoh.cloud/gh/SagerNet/sing-geosite@rule-set/geosite-apple.srs"
            },
            {
                "tag": "geosite-microsoft-cn",
                "type": "remote",
                "format": "binary",
                "url": "https://jsdelivr.oneoh.cloud/gh/SagerNet/sing-geosite@rule-set/geosite-microsoft@cn.srs"
            },
            {
                "tag": "geosite-samsung",
                "type": "remote",
                "format": "binary",
                "url": "https://jsdelivr.oneoh.cloud/gh/SagerNet/sing-geosite@rule-set/geosite-samsung.srs"
            },
            {
                "tag": "geosite-telegram",
                "type": "remote",
                "format": "binary",
                "url": "https://jsdelivr.oneoh.cloud/gh/SagerNet/sing-geosite@rule-set/geosite-telegram.srs"
            },
            {
                "tag": "geosite-private",
                "type": "remote",
                "format": "binary",
                "url": "https://jsdelivr.oneoh.cloud/gh/SagerNet/sing-geosite@rule-set/geosite-private.srs"
            }
        ],
        "auto_detect_interface": true
    },
    "experimental": {
        "clash_api": {}, // 此字段将被忽略
        "cache_file": {} // 此字段将被忽略
    },
    // ------------------ Outbounds ------------------
    // OneBox 会自动追加远程配置或者本地配置内容中的服务节点
    // 到 outbounds 以及 ExitGateway["outbounds"] 和 auto["outbounds"] 中
    // 如果需要添加自定义的出站，可以在此处添加，但请不要有重复的 tag 名称以及修改以下三个出站的 tag 名称
    // 记住一个修改原则：只追加，不修改，不删除，不重复
    "outbounds": [
        {
            "tag": "direct",
            "type": "direct",
            "domain_resolver": "system"
        },
        {
            "tag": "ExitGateway",
            "type": "selector",
            "outbounds": [
                "auto"
            ],
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

const TunGlobalConfig = {
    "log": {
        "disabled": false,
        "level": "debug",
        "timestamp": false
    },
    "dns": {
        "servers": [
            {
                "tag": "system", // 🚫 禁止修改 tag 名称
                "type": "udp",
                "server": "119.29.29.29",
                "server_port": 53,
                "connect_timeout": "5s"
            },
            {
                "tag": "dns_proxy", // 🚫 禁止修改 tag 名称
                "type": "tcp",
                "server": "1.0.0.1",
                "detour": "ExitGateway",
                "connect_timeout": "5s"
            },
            {
                "tag": "remote", // 🚫 禁止修改 tag 名称
                "type": "fakeip",
                "inet4_range": "198.18.0.0/15",
                "inet6_range": "fc00::/18"
            }
        ],
        "rules": [
            {
                "domain": [
                    "captive.oneoh.cloud",
                    "captive.apple.com",
                    "nmcheck.gnome.org",
                    "www.msftconnecttest.com",
                    "connectivitycheck.gstatic.com"
                ],
                "server": "system",
                "strategy": "prefer_ipv4"
            },
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
        "final": "dns_proxy" // 🚫 禁止修改
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
                    "server_port": 6789
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
            "tag": "mixed", // 🚫 禁止修改 tag 名称
            "type": "mixed",
            "listen": "127.0.0.1",
            "listen_port": 6789, // 🚫 禁止修改
            "reuse_addr": true,
            "tcp_fast_open": true,
            "set_system_proxy": false
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
                    "captive.oneoh.cloud",
                    "captive.apple.com",
                    "nmcheck.gnome.org",
                    "www.msftconnecttest.com",
                    "connectivitycheck.gstatic.com"
                ],
                "domain_suffix": [
                    "local",
                    "lan",
                    "localdomain",
                    "localhost",
                    "bypass.local",
                    "captive.apple.com"
                ],
                "outbound": "direct"
            }
        ],
        "final": "ExitGateway", // 🚫 禁止修改
        "auto_detect_interface": true,
        "rule_set": [
            {
                "tag": "geoip-cn",
                "type": "remote",
                "format": "binary",
                "url": "https://jsdelivr.oneoh.cloud/gh/MetaCubeX/meta-rules-dat@sing/geo/geoip/cn.srs"
            },
            {
                "type": "remote",
                "tag": "geosite-geolocation-cn",
                "format": "source",
                "url": "https://jsdelivr.oneoh.cloud/gh/MetaCubeX/meta-rules-dat@sing/geo/geosite/geolocation-cn.json"
            },
            {
                "tag": "geosite-linkedin",
                "type": "remote",
                "format": "binary",
                "url": "https://jsdelivr.oneoh.cloud/gh/SagerNet/sing-geosite@rule-set/geosite-linkedin.srs"
            },
            {
                "tag": "geosite-linkedin-cn",
                "type": "remote",
                "format": "binary",
                "url": "https://jsdelivr.oneoh.cloud/gh/SagerNet/sing-geosite@rule-set/geosite-linkedin@cn.srs"
            },
            {
                "type": "remote",
                "tag": "geosite-geolocation-!cn",
                "format": "source",
                "url": "https://jsdelivr.oneoh.cloud/gh/MetaCubeX/meta-rules-dat@sing/geo/geosite/geolocation-!cn.json"
            },
            {
                "tag": "geosite-cn",
                "type": "remote",
                "format": "binary",
                "url": "https://jsdelivr.oneoh.cloud/gh/OneOhCloud/one-geosite@rules/geosite-one-cn.srs"
            },
            {
                "tag": "geosite-apple",
                "type": "remote",
                "format": "binary",
                "url": "https://jsdelivr.oneoh.cloud/gh/SagerNet/sing-geosite@rule-set/geosite-apple.srs"
            },
            {
                "tag": "geosite-microsoft-cn",
                "type": "remote",
                "format": "binary",
                "url": "https://jsdelivr.oneoh.cloud/gh/SagerNet/sing-geosite@rule-set/geosite-microsoft@cn.srs"
            },
            {
                "tag": "geosite-samsung",
                "type": "remote",
                "format": "binary",
                "url": "https://jsdelivr.oneoh.cloud/gh/SagerNet/sing-geosite@rule-set/geosite-samsung.srs"
            },
            {
                "tag": "geosite-telegram",
                "type": "remote",
                "format": "binary",
                "url": "https://jsdelivr.oneoh.cloud/gh/SagerNet/sing-geosite@rule-set/geosite-telegram.srs"
            },
            {
                "tag": "geosite-private",
                "type": "remote",
                "format": "binary",
                "url": "https://jsdelivr.oneoh.cloud/gh/SagerNet/sing-geosite@rule-set/geosite-private.srs"
            }
        ]
    },
    "experimental": {
        "clash_api": {}, // 此字段将被忽略
        "cache_file": {} // 此字段将被忽略
    },
    // ------------------ Outbounds ------------------
    // OneBox 会自动追加远程配置或者本地配置内容中的服务节点
    // 到 outbounds 以及 ExitGateway["outbounds"] 和 auto["outbounds"] 中
    // 如果需要添加自定义的出站，可以在此处添加，但请不要有重复的 tag 名称以及修改以下三个出站的 tag 名称
    // 记住一个修改原则：只追加，不修改，不删除，不重复
    "outbounds": [
        {
            "tag": "direct",
            "type": "direct",
            "domain_resolver": "system"
        },
        {
            "tag": "ExitGateway",
            "type": "selector",
            "outbounds": [
                "auto"
            ],
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



export function getDefaultConfigTemplate(mode: configType, version: string): string {
    if (version.startsWith("v1.12")) {
        switch (mode) {
            case 'mixed':
                return JSON.stringify(mixedRulesConfig)
            case 'mixed-global':
                return JSON.stringify(miexdGlobalConfig)
            case 'tun':
                return JSON.stringify(TunRulesConfig);
            case 'tun-global':
                return JSON.stringify(TunGlobalConfig);
        }
    } else {
        alert("Only version 1.12.x is supported at the moment.")
        throw new Error("Unsupported version")
    }
}