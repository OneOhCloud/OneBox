import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

// 获取 Tauri 版本号
function getAppVersion(): string {
    const tauriConfPath = join(process.cwd(), "src-tauri/tauri.conf.json");
    const content = readFileSync(tauriConfPath, "utf-8");
    const config = JSON.parse(content);

    if (!config.version) {
        throw new Error("Could not find version in tauri.conf.json");
    }

    return config.version;
}

// 获取当前日期 (YYYY-MM-DD 格式)
function getCurrentDate(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

// 处理 CHANGELOG
function processChangelog(): void {
    const changelogPath = join(process.cwd(), "CHANGELOG.MD");
    let content = readFileSync(changelogPath, "utf-8");

    const version = getAppVersion();
    const date = getCurrentDate();
    const replacement = `Version ${version} (${date} UTC)`;

    // 替换占位符
    content = content.replace(/\{\{version-tag-date\}\}/g, replacement);

    writeFileSync(changelogPath, content, "utf-8");

    console.log(`✓ CHANGELOG processed`);
    console.log(`  Version: ${version}`);
    console.log(`  Date: ${date}`);
    console.log(`  Replacement: ${replacement}`);
}

processChangelog();
