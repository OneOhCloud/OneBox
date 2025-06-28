import { BaseDirectory, create, exists, writeFile } from '@tauri-apps/plugin-fs';
import { getClashApiSecret } from '../single/store';


/**
 * 将数据写入指定的配置文件
 * 
 * 该函数会检查指定的配置文件是否存在，如果存在则直接写入数据；
 * 如果不存在，则先创建文件再写入数据。
 * 
 * @param fileName - 要写入的配置文件名
 * @param data - 要写入的二进制数据
 * @returns 返回一个Promise，表示写入操作的完成
 * 
 * @example
 * ```
 * // 写入一个JSON配置文件
 * const jsonData = new TextEncoder().encode(JSON.stringify({ setting: true }));
 * await writeConfigFile("settings.json", jsonData);
 * ```
 */
export async function writeConfigFile(fileName: string, data: Uint8Array) {

    const configExists = await exists(fileName, {
        baseDir: BaseDirectory.AppConfig,
    });
    if (configExists) {
        await writeFile(fileName, data, {
            baseDir: BaseDirectory.AppConfig,
        });

    } else {
        const file = await create(fileName, { baseDir: BaseDirectory.AppConfig });
        await file.write(data);
        await file.close();

    }
}


type Item = {
    tag: string;
    type: string;
}


export async function updateVPNServerConfigFromDB(fileName: string, dbConfigData: any, newConfig: any) {

    const outboundsSelectorIndex = 1;
    const outboundsUrltestIndex = 2;

    const outbound_groups = newConfig["outbounds"];
    const outboundsSelector = outbound_groups[outboundsSelectorIndex]["outbounds"];
    const outboundsUrltest = outbound_groups[outboundsUrltestIndex]["outbounds"];


    let vpnServerList = dbConfigData.outbounds.filter((item: Item) => {
        // zh: 只找VPN服务器的节点配置
        // en: Only find the node configuration of the VPN server
        return item.type !== "selector" && item.type !== "urltest" && item.type !== "direct" && item.type !== "block";
    });


    for (let i = 0; i < vpnServerList.length; i++) {
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




export async function setGlobalMixedConfig(identifier: string, version: string) {
    if (version.startsWith("v1.11")) {
        const module = await import("./version_1_11/global-mixed-config");
        return await module.default(identifier);
    } else {
        throw new Error("Unsupported version for setGlobalMixedConfig");
    }


}

export async function setGlobalTunConfig(identifier: string, version: string) {
    if (version.startsWith("v1.11")) {
        const module = await import("./version_1_11/global-tun-config");
        return await module.default(identifier);
    } else {
        throw new Error("Unsupported version for setGlobalTunConfig");
    }
}

export async function setMixedConfig(identifier: string, version: string) {
    if (version.startsWith("v1.11")) {
        const module = await import("./version_1_11/mixed-config");
        return await module.default(identifier);
    } else {
        throw new Error("Unsupported version for setMixedConfig");
    }
}

export async function setTunConfig(identifier: string, version: string) {
    if (version.startsWith("v1.11")) {
        const module = await import("./version_1_11/tun-config");
        return await module.default(identifier);
    } else {
        throw new Error("Unsupported version for setTunConfig");
    }
}