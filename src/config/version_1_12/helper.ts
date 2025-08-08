import { getClashApiSecret } from "../../single/store";
import { writeConfigFile } from "../helper";


type Item = {
    tag: string;
    type: string;
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


    let vpnServerList = dbConfigData.outbounds.filter((item: Item) => {
        // zh: 只找VPN服务器的节点配置
        // en: Only find the node configuration of the VPN server
        let flag = item.type !== "selector" && item.type !== "urltest" && item.type !== "direct" && item.type !== "block";

        // zh: sing-box 1.12 版本开始，dns 类型的节点不再需要
        // en: From sing-box version 1.12, dns type nodes are no longer
        flag = flag && item.type !== "dns";
        return flag;
    });


    for (let i = 0; i < vpnServerList.length; i++) {
        vpnServerList[i]["domain_resolver"] = "system";
        outboundsSelector.push(vpnServerList[i].tag);

    }

    const urltestNameList: string[] = [];
    vpnServerList.forEach((item: any) => {
        urltestNameList.push(item.tag);
    })

    outboundsUrltest.push(...urltestNameList);

    outbound_groups.push(...vpnServerList);

    newConfig["experimental"]["clash_api"]["secret"] = await getClashApiSecret();

    await writeConfigFile(fileName, new TextEncoder().encode(JSON.stringify(newConfig)));


}
