import { type } from '@tauri-apps/plugin-os';
import { getDirectDNS, getStoreValue, getUseDHCP } from "../../single/store";
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

export async function configureTunInbound(newConfig: any): Promise<void> {
    const tunInbound = newConfig.inbounds.find((ib: Item) => ib.type === "tun" && ib.tag === "tun");
    if (!tunInbound) return;

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

    console.log("当前 TUN Stack:", tunInbound.stack);
}

export function configureMixedInbound(newConfig: any, allowLan: boolean): void {
    const mixedInbound = newConfig.inbounds.find((ib: Item) => ib.type === "mixed" && ib.tag === "mixed");
    if (mixedInbound) mixedInbound.listen = allowLan ? "0.0.0.0" : "127.0.0.1";
}


