
import { BaseDirectory, create, exists, writeFile } from '@tauri-apps/plugin-fs';

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



