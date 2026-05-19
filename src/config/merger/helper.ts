import { type } from '@tauri-apps/plugin-os';
import { getDirectDNS, getProxyPort, getStoreValue, getUseDHCP } from "../../single/store";
import { TUN_INTERFACE_NAME, TUN_STACK_STORE_KEY } from "../../types/definition";
import { writeConfigFile } from "../helper";



type Item = {
    tag: string;
    type: string;
}



export async function updateDHCPSettings2Config(newConfig: any) {
    const useDHCP = await getUseDHCP();
    for (let i = 0; i < newConfig.dns.servers.length; i++) {
        const server = newConfig.dns.servers[i];
        if (server.tag === "system") {
            if (useDHCP) {
                server.type = "dhcp";
                delete server.server;
                delete server.server_port;
                console.log("启用 DHCP DNS 模式");
            } else {
                let directDNS = await getDirectDNS();
                console.log("当前使用直连 DNS 地址：", directDNS);
                server.type = "udp";
                server.server = directDNS.trim();
                server.server_port = 53;
                console.log("启用 UDP DNS 模式, 服务器地址：", server.server);
            }
        }
    }
}

/**
 * 只提取 VPN 服务器节点配置合并到配置文件中
 */
export async function updateVPNServerConfigFromDB(fileName: string, dbConfigData: any, newConfig: any) {

    if (!dbConfigData?.outbounds) {
        throw new Error('subscription_config_missing');
    }

    const outboundsSelectorIndex = 1;
    const outboundsUrltestIndex = 2;

    const outbound_groups = newConfig["outbounds"];
    const outboundsSelector = outbound_groups[outboundsSelectorIndex]["outbounds"];
    const outboundsUrltest = outbound_groups[outboundsUrltestIndex]["outbounds"];


    const seenTags = new Set<string>();
    const vpnServerList = dbConfigData.outbounds.filter((item: Item) => {
        // zh: 只找VPN服务器的节点配置
        // en: Only find the node configuration of the VPN server
        let flag = item.type !== "selector" && item.type !== "urltest" && item.type !== "direct" && item.type !== "block";

        // zh: sing-box 1.12 版本开始，dns 类型的节点不再需要
        // en: From sing-box version 1.12, dns type nodes are no longer
        flag = flag && item.type !== "dns";

        // Deduplicate by tag: skip any server whose tag has already been seen.
        // This guards against duplicate tags in the remote subscription config and
        // any concurrent-write edge case that could produce the same tag twice.
        if (flag && seenTags.has(item.tag)) {
            console.warn(`[CONFIG] Skipping duplicate outbound tag: ${item.tag}`);
            return false;
        }
        if (flag) seenTags.add(item.tag);
        return flag;
    });

    for (let i = 0; i < vpnServerList.length; i++) {
        vpnServerList[i]["domain_resolver"] = "system";
        outboundsSelector.push(vpnServerList[i].tag);
    }

    const urltestNameList: string[] = vpnServerList.map((item: any) => item.tag);

    outboundsUrltest.push(...urltestNameList);

    outbound_groups.push(...vpnServerList);


    await writeConfigFile(fileName, new TextEncoder().encode(JSON.stringify(newConfig)));


}

export async function configureTunInbound(newConfig: any, bypassRouter: boolean = false): Promise<void> {
    const tunInbound = newConfig.inbounds.find((ib: Item) => ib.type === "tun" && ib.tag === "tun");
    if (!tunInbound) return;
    const proxyPort = await getProxyPort();

    if (tunInbound.platform?.http_proxy) {
        tunInbound.platform.http_proxy.server_port = proxyPort;
    }

    const osType = type();
    if (osType === "linux") {
        tunInbound.stack = "system";
    }
    // macOS 强制使用 gvisor stack，经过测试 system stack 无法正常运作
    if (osType !== "macos" && await getStoreValue(TUN_STACK_STORE_KEY)) {
        tunInbound.stack = await getStoreValue(TUN_STACK_STORE_KEY);
    }
    // macOS 固定接口名，退出时可精确清理该接口的路由
    if (osType === "macos") {
        tunInbound.interface_name = TUN_INTERFACE_NAME;
    }

    // 旁路由模式：其它主机以本机为网关/DNS 转发进来的包，源地址必然落在 RFC1918
    // 网段内。模板默认把这三段放进 route_exclude_address，会让 TUN 栈在进入 sing-box
    // 路由引擎之前就把包放掉，hijack-dns 永远不命中。启用旁路由时必须剔除。
    if (bypassRouter && Array.isArray(tunInbound.route_exclude_address)) {
        const lanRanges = new Set(["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]);
        tunInbound.route_exclude_address = tunInbound.route_exclude_address.filter(
            (cidr: string) => !lanRanges.has(cidr),
        );
        // 华硕路由器的「WAN 中断浏览器导页通知」会在检测到外网异常时，把所有 DNS
        // 应答劫持成 10.0.0.1 的导页 IP（见 https://github.com/pymumu/smartdns/issues/541）。
        // 上面剔除 10.0.0.0/8 后，本机访问该 IP 的包会被 auto_route 吸进 TUN，
        // 形成自路由回环，dial 永远超时；单独把这一个 host 留在排除清单里。
        tunInbound.route_exclude_address.push("10.0.0.1/32");
    }

    // 旁路由模式：LAN 设备把 DNS 指向本机时，sing-box 需要在 UDP:53 上监听
    // 才能接收并 hijack 这些 DNS 请求。模板默认不含这个 inbound（普通 TUN
    // 模式下 DNS 通过 TUN 网关的 hijack-dns 路由规则拦截，不需要单独监听）。
    if (bypassRouter) {
        const hasDnsIn = newConfig.inbounds.some((ib: Item) => ib.tag === "dns-in");
        if (!hasDnsIn) {
            newConfig.inbounds.push({
                tag: "dns-in",
                type: "direct",
                listen: "::",
                listen_port: 53,
            });
            console.log("旁路由模式：注入 dns-in inbound ([::]:53)");
        }
    }

    console.log("当前 TUN Stack:", tunInbound.stack);
}

export async function configureMixedInbound(newConfig: any, allowLan: boolean, bypassRouter: boolean = false): Promise<void> {
    const mixedInbound = newConfig.inbounds.find((ib: Item) => ib.type === "mixed" && ib.tag === "mixed");
    if (mixedInbound) {
        mixedInbound.listen = (allowLan || bypassRouter) ? "0.0.0.0" : "127.0.0.1";
        mixedInbound.listen_port = await getProxyPort();
    }
}
