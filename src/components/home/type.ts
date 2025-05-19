const a = {
  "proxies": {
    "GLOBAL": {
      "all": [
        "ExitGateway",
        "auto",
        "电信专用",
        "新加坡6",
        "日　本1",
        "日　本3",
        "日　本4",
        "首　尔1",
        "孟　买1",
        "新加坡3",
        "新加坡5",
        "新加坡1",
        "新加坡2",
        "加拿大1",
        "英　国1",
        "法　国1",
        "美　国1",
        "美　国2",
        "美　国3",
        "测试节点",
        "美　国4",
        "官网:next.n2ray.dev",
        "已用:9.5%",
        "到期:2026-11-19"
      ],
      "history": [],
      "name": "GLOBAL",
      "now": "ExitGateway",
      "type": "Fallback",
      "udp": true
    },
    "direct": {
      "type": "Direct",
      "name": "direct",
      "udp": true,
      "history": []
    },
    "ExitGateway": {
      "type": "Selector",
      "name": "ExitGateway",
      "udp": true,
      "history": [],
      "now": "auto",
      "all": [
        "auto",
        "电信专用",
        "新加坡6",
        "日　本1",
        "日　本3",
        "日　本4",
        "首　尔1",
        "孟　买1",
        "新加坡3",
        "新加坡5",
        "新加坡1",
        "新加坡2",
        "加拿大1",
        "英　国1",
        "法　国1",
        "美　国1",
        "美　国2",
        "美　国3",
        "测试节点",
        "美　国4",
        "官网:next.n2ray.dev",
        "已用:9.5%",
        "到期:2026-11-19"
      ]
    },
    "auto": {
      "type": "URLTest",
      "name": "auto",
      "udp": true,
      "history": [
        {
          "time": "2025-04-14T14:25:08.885576+08:00",
          "delay": 188
        }
      ],
      "now": "日　本1",
      "all": [
        "电信专用",
        "新加坡6",
        "日　本1",
        "日　本3",
        "日　本4",
        "首　尔1",
        "孟　买1",
        "新加坡3",
        "新加坡5",
        "新加坡1",
        "新加坡2",
        "加拿大1",
        "英　国1",
        "法　国1",
        "美　国1",
        "美　国2",
        "美　国3",
        "测试节点",
        "美　国4",
        "官网:next.n2ray.dev",
        "已用:9.5%",
        "到期:2026-11-19"
      ]
    },
    "电信专用": {
      "type": "TUIC",
      "name": "电信专用",
      "udp": true,
      "history": [
        {
          "time": "2025-04-14T14:25:09.280996+08:00",
          "delay": 429
        }
      ]
    },
    "新加坡6": {
      "type": "TUIC",
      "name": "新加坡6",
      "udp": true,
      "history": [
        {
          "time": "2025-04-14T14:25:08.872404+08:00",
          "delay": 175
        }
      ]
    },
    "日　本1": {
      "type": "TUIC",
      "name": "日　本1",
      "udp": true,
      "history": [
        {
          "time": "2025-04-14T14:25:08.885576+08:00",
          "delay": 188
        }
      ]
    },
    "日　本3": {
      "type": "TUIC",
      "name": "日　本3",
      "udp": true,
      "history": [
        {
          "time": "2025-04-14T14:25:08.937961+08:00",
          "delay": 239
        }
      ]
    },
    "日　本4": {
      "type": "TUIC",
      "name": "日　本4",
      "udp": true,
      "history": [
        {
          "time": "2025-04-14T14:25:08.880223+08:00",
          "delay": 180
        }
      ]
    },
    "首　尔1": {
      "type": "TUIC",
      "name": "首　尔1",
      "udp": true,
      "history": [
        {
          "time": "2025-04-14T14:25:09.10721+08:00",
          "delay": 409
        }
      ]
    },
    "孟　买1": {
      "type": "TUIC",
      "name": "孟　买1",
      "udp": true,
      "history": [
        {
          "time": "2025-04-14T14:25:09.040622+08:00",
          "delay": 342
        }
      ]
    },
    "新加坡3": {
      "type": "TUIC",
      "name": "新加坡3",
      "udp": true,
      "history": [
        {
          "time": "2025-04-14T14:25:08.872404+08:00",
          "delay": 175
        }
      ]
    },
    "新加坡5": {
      "type": "TUIC",
      "name": "新加坡5",
      "udp": true,
      "history": [
        {
          "time": "2025-04-14T14:25:08.851577+08:00",
          "delay": 153
        }
      ]
    },
    "新加坡1": {
      "type": "TUIC",
      "name": "新加坡1",
      "udp": true,
      "history": [
        {
          "time": "2025-04-14T14:25:08.955642+08:00",
          "delay": 166
        }
      ]
    },
    "新加坡2": {
      "type": "TUIC",
      "name": "新加坡2",
      "udp": true,
      "history": [
        {
          "time": "2025-04-14T14:25:09.034047+08:00",
          "delay": 161
        }
      ]
    },
    "加拿大1": {
      "type": "TUIC",
      "name": "加拿大1",
      "udp": true,
      "history": [
        {
          "time": "2025-04-14T14:25:09.411567+08:00",
          "delay": 531
        }
      ]
    },
    "英　国1": {
      "type": "TUIC",
      "name": "英　国1",
      "udp": true,
      "history": [
        {
          "time": "2025-04-14T14:25:09.280646+08:00",
          "delay": 394
        }
      ]
    },
    "法　国1": {
      "type": "TUIC",
      "name": "法　国1",
      "udp": true,
      "history": [
        {
          "time": "2025-04-14T14:25:09.280646+08:00",
          "delay": 342
        }
      ]
    },
    "美　国1": {
      "type": "TUIC",
      "name": "美　国1",
      "udp": true,
      "history": [
        {
          "time": "2025-04-14T14:25:09.388721+08:00",
          "delay": 432
        }
      ]
    },
    "美　国2": {
      "type": "TUIC",
      "name": "美　国2",
      "udp": true,
      "history": [
        {
          "time": "2025-04-14T14:25:09.30666+08:00",
          "delay": 434
        }
      ]
    },
    "美　国3": {
      "type": "TUIC",
      "name": "美　国3",
      "udp": true,
      "history": [
        {
          "time": "2025-04-14T14:25:09.495384+08:00",
          "delay": 454
        }
      ]
    },
    "测试节点": {
      "type": "TUIC",
      "name": "测试节点",
      "udp": true,
      "history": []
    },
    "美　国4": {
      "type": "TUIC",
      "name": "美　国4",
      "udp": true,
      "history": [
        {
          "time": "2025-04-14T14:25:09.538624+08:00",
          "delay": 504
        }
      ]
    },
    "官网:next.n2ray.dev": {
      "type": "TUIC",
      "name": "官网:next.n2ray.dev",
      "udp": true,
      "history": [
        {
          "time": "2025-04-14T14:25:09.676917+08:00",
          "delay": 486
        }
      ]
    },
    "已用:9.5%": {
      "type": "TUIC",
      "name": "已用:9.5%",
      "udp": true,
      "history": [
        {
          "time": "2025-04-14T14:25:09.770783+08:00",
          "delay": 490
        }
      ]
    },
    "到期:2026-11-19": {
      "type": "TUIC",
      "name": "到期:2026-11-19",
      "udp": true,
      "history": [
        {
          "time": "2025-04-14T14:25:09.190755+08:00",
          "delay": 493
        }
      ]
    }
  }
}