export const DEFAULT_SYSTEM_DNS = "119.29.29.29"


export const ruleSet = [
    {
        "tag": "geoip-cn",
        "type": "remote",
        "format": "binary",
        "url": "https://jsdelivr.oneoh.cloud/gh/MetaCubeX/meta-rules-dat@sing/geo/geoip/cn.srs",

    },
    {
        "type": "remote",
        "tag": "geosite-geolocation-cn",
        "format": "source",
        "url": "https://jsdelivr.oneoh.cloud/gh/MetaCubeX/meta-rules-dat@sing/geo/geosite/geolocation-cn.json"
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
        "url": "https://jsdelivr.oneoh.cloud/gh/OneOhCloud/one-geosite@rules/geosite-one-cn.srs",

    },
    {
        "tag": "geosite-apple",
        "type": "remote",
        "format": "binary",
        "url": "https://jsdelivr.oneoh.cloud/gh/SagerNet/sing-geosite@rule-set/geosite-apple.srs",

    },
    {
        "tag": "geosite-microsoft-cn",
        "type": "remote",
        "format": "binary",
        "url": "https://jsdelivr.oneoh.cloud/gh/SagerNet/sing-geosite@rule-set/geosite-microsoft@cn.srs",

    },
    {
        "tag": "geosite-samsung",
        "type": "remote",
        "format": "binary",
        "url": "https://jsdelivr.oneoh.cloud/gh/SagerNet/sing-geosite@rule-set/geosite-samsung.srs",

    },
    {
        "tag": "geosite-telegram",
        "type": "remote",
        "format": "binary",
        "url": "https://jsdelivr.oneoh.cloud/gh/SagerNet/sing-geosite@rule-set/geosite-telegram.srs",

    },
    {
        "tag": "geosite-private",
        "type": "remote",
        "format": "binary",
        "url": "https://jsdelivr.oneoh.cloud/gh/SagerNet/sing-geosite@rule-set/geosite-private.srs",

    }
]



export const clashApi = {
    "external_controller": "127.0.0.1:9191",
    "secret": "",
}