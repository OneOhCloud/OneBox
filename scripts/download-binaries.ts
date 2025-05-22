import fs, { createWriteStream } from 'fs';
import path from 'path';
import { pipeline } from 'stream';
import { x } from 'tar';
import unzipper from 'unzipper';
import { promisify } from 'util';
import { SING_BOX_VERSION } from '../src/types/definition';

// 配置常量
const BINARY_NAME = 'sing-box';
const GITHUB_RELEASE_URL = 'https://github.com/SagerNet/sing-box/releases/download/';

// sysproxy 下载地址, 仅支持 Windows x64 版本。
const SYSPROXY_URL = "https://github.com/clash-verge-rev/sysproxy/releases/download/x64/sysproxy.exe";

// 支持的目标架构映射
const RUST_TARGET_TRIPLES = {
    "darwin": {
        "arm64": "aarch64-apple-darwin",
        "amd64": "x86_64-apple-darwin"
    },
    "linux": {
        "amd64": "x86_64-unknown-linux-gnu",
        "arm64": "aarch64-unknown-linux-gnu"
    },
    "windows": {
        "amd64": "x86_64-pc-windows-msvc",
    }
} as const;

type Platform = keyof typeof RUST_TARGET_TRIPLES;
type Architecture = keyof typeof RUST_TARGET_TRIPLES[Platform];

async function downloadFile(url: string, dest: string): Promise<void> {
    const streamPipeline = promisify(pipeline);
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`下载失败: '${url}' (${response.status})`);
    }

    if (!response.body) {
        throw new Error('响应体为空');
    }

    await streamPipeline(response.body as any, createWriteStream(dest));
}

async function extractFile(filePath: string, fileExtension: string, tmpDir: string): Promise<void> {
    if (fileExtension === 'zip') {
        await fs.createReadStream(filePath).pipe(unzipper.Extract({ path: tmpDir })).promise();
    } else {
        await x({ file: filePath, cwd: tmpDir });
    }
}

async function embeddingExternalBinaries(
    platform: Platform,
    arch: Architecture,
    extension: string,
    targetTriple: string
): Promise<void> {
    const fileExtension = platform === 'windows' ? 'zip' : 'tar.gz';
    const fileName = `${BINARY_NAME}-${platform}-${arch}.${fileExtension}`;
    const downloadUrl = `${GITHUB_RELEASE_URL}${SING_BOX_VERSION}/${BINARY_NAME}-${SING_BOX_VERSION.substring(1)}-${platform}-${arch}.${fileExtension}`;
    const tmpDir = path.join(__dirname, 'tmp');
    const downloadPath = path.join(tmpDir, fileName);

    try {
        // 创建临时目录
        !fs.existsSync(tmpDir) && fs.mkdirSync(tmpDir, { recursive: true });

        // 下载和解压文件
        console.log(`正在下载 ${platform}-${arch}-${SING_BOX_VERSION} 版本的 sing-box...`);
        await downloadFile(downloadUrl, downloadPath);
        await extractFile(downloadPath, fileExtension, tmpDir);

        // 移动文件到目标位置
        const extractedFilePath = path.join(tmpDir, `${BINARY_NAME}-${SING_BOX_VERSION.substring(1)}-${platform}-${arch}/${BINARY_NAME}${extension}`);
        const targetPath = `src-tauri/binaries/${BINARY_NAME}-${targetTriple}${extension}`;

        // 确保目标目录存在
        const targetDir = path.dirname(targetPath);
        !fs.existsSync(targetDir) && fs.mkdirSync(targetDir, { recursive: true });

        // 移动文件并清理
        fs.renameSync(extractedFilePath, targetPath);
        fs.rmSync(tmpDir, { recursive: true, force: true });

        console.log(`${platform}-${arch} 版本处理完成`);
    } catch (error) {
        console.error('处理失败:', error);
        throw error;
    }
}

async function downloadEmbeddingExternalBinaries(): Promise<void> {
    for (const [platform, archs] of Object.entries(RUST_TARGET_TRIPLES)) {
        for (const [arch, targetTriple] of Object.entries(archs)) {
            const extension = platform === 'windows' ? '.exe' : '';
            await embeddingExternalBinaries(
                platform as Platform,
                arch as Architecture,
                extension,
                targetTriple
            );

            // 为 Windows x64 下载 sysproxy
            if (platform === 'windows' && arch === 'amd64') {
                console.log('正在下载 Windows sysproxy...');
                const targetPath = `src-tauri/binaries/sysproxy-${targetTriple}${extension}`;

                // 确保目标目录存在
                const targetDir = path.dirname(targetPath);
                !fs.existsSync(targetDir) && fs.mkdirSync(targetDir, { recursive: true });

                await downloadFile(SYSPROXY_URL, targetPath);
                console.log('sysproxy 下载完成');
            }
        }
    }
}

// 执行下载任务
downloadEmbeddingExternalBinaries().catch(console.error);
