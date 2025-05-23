
export const ruleSet = [
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
        "tag": "geosite-telegram",
        "type": "remote",
        "format": "binary",
        "url": "https://fastly.jsdelivr.net/gh/SagerNet/sing-geosite@rule-set/geosite-telegram.srs",
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



export const clashApi = {
    "external_controller": "127.0.0.1:9191",
    "secret": "",
}