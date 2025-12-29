import fs, { createWriteStream } from 'fs';
import path from 'path';
import { pipeline } from 'stream';
import { x } from 'tar';
import unzipper from 'unzipper';
import { promisify } from 'util';
import { SING_BOX_VERSION } from '../src/types/definition';

const BINARY_NAME = 'sing-box';
const GITHUB_RELEASE_URL = 'https://github.com/SagerNet/sing-box/releases/download/';

// sysproxy download URL, only supports Windows x64 version.
const SYSPROXY_URL = "https://github.com/clash-verge-rev/sysproxy/releases/download/x64/sysproxy.exe";


const SkipVersionList = [
    "v1.12.5", //This version of sing-box has DNS issues, skip downloading
];

// Supported target architecture mapping
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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 seconds timeout

    const response = await fetch(url, {
        signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId));

    if (!response.ok) {
        throw new Error(`Download failed: '${url}' (${response.status})`);
    }

    if (!response.body) {
        throw new Error('Response body is empty');
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
    const startTime = Date.now();
    const fileExtension = platform === 'windows' ? 'zip' : 'tar.gz';
    const fileName = `${BINARY_NAME}-${platform}-${arch}.${fileExtension}`;
    const downloadUrl = `${GITHUB_RELEASE_URL}${SING_BOX_VERSION}/${BINARY_NAME}-${SING_BOX_VERSION.substring(1)}-${platform}-${arch}.${fileExtension}`;
    // 为每个任务创建唯一的临时目录s
    const tmpDir = path.join(__dirname, 'tmp', `${platform}-${arch}-${Date.now()}-${Math.random().toString(36).substring(7)}`);
    const downloadPath = path.join(tmpDir, fileName);

    try {
        // Create temporary directory
        !fs.existsSync(tmpDir) && fs.mkdirSync(tmpDir, { recursive: true });

        // Download and extract file
        console.log(`Downloading sing-box version ${platform}-${arch}-${SING_BOX_VERSION}...`);
        await downloadFile(downloadUrl, downloadPath);
        await extractFile(downloadPath, fileExtension, tmpDir);

        // Move file to target location
        const extractedFilePath = path.join(tmpDir, `${BINARY_NAME}-${SING_BOX_VERSION.substring(1)}-${platform}-${arch}/${BINARY_NAME}${extension}`);
        const targetPath = `src-tauri/binaries/${BINARY_NAME}-${targetTriple}${extension}`;

        // Ensure target directory exists
        const targetDir = path.dirname(targetPath);
        !fs.existsSync(targetDir) && fs.mkdirSync(targetDir, { recursive: true });

        // Move file and cleanup
        fs.renameSync(extractedFilePath, targetPath);
        fs.rmSync(tmpDir, { recursive: true, force: true });

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`${platform}-${arch} version processed successfully (${elapsed}s)`);
    } catch (error) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.error(`Processing failed after ${elapsed}s:`, error);
        throw error;
    }
}

async function downloadEmbeddingExternalBinaries(): Promise<void> {
    const downloadTasks: Promise<void>[] = [];

    for (const [platform, archs] of Object.entries(RUST_TARGET_TRIPLES)) {
        for (const [arch, targetTriple] of Object.entries(archs)) {
            const extension = platform === 'windows' ? '.exe' : '';
            downloadTasks.push(
                embeddingExternalBinaries(
                    platform as Platform,
                    arch as Architecture,
                    extension,
                    targetTriple
                )
            );

            // Download sysproxy for Windows amd64
            if (platform === 'windows' && arch === 'amd64') {
                downloadTasks.push(
                    (async () => {
                        const startTime = Date.now();
                        console.log('Downloading Windows sysproxy...');
                        const targetPath = `src-tauri/binaries/sysproxy-${targetTriple}${extension}`;

                        // Ensure target directory exists
                        const targetDir = path.dirname(targetPath);
                        !fs.existsSync(targetDir) && fs.mkdirSync(targetDir, { recursive: true });

                        await downloadFile(SYSPROXY_URL, targetPath);
                        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
                        console.log(`sysproxy download completed (${elapsed}s)`);
                    })()
                );
            }
        }
    }

    await Promise.all(downloadTasks);
}

// 下载数据库文件到 src-tauri/resources 目录
async function downloadDatabaseFiles(): Promise<void> {
    const dbFiles = [
        {
            name: 'mixed-cache-rule-v1.db',
            url: 'https://github.com/OneOhCloud/conf-template/raw/refs/heads/stable/database/1.12/zh-cn/mixed-cache-rule-v1.db'
        },
        {
            name: 'tun-cache-rule-v1.db',
            url: 'https://github.com/OneOhCloud/conf-template/raw/refs/heads/stable/database/1.12/zh-cn/tun-cache-rule-v1.db'
        }
    ];

    const resourcesDir = 'src-tauri/resources';
    !fs.existsSync(resourcesDir) && fs.mkdirSync(resourcesDir, { recursive: true });

    const downloadTasks = dbFiles.map(async (dbFile) => {
        const startTime = Date.now();
        const destPath = path.join(resourcesDir, dbFile.name);
        console.log(`Downloading database file: ${dbFile.name}...`);
        await downloadFile(dbFile.url, destPath);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`Downloaded database file to: ${destPath} (${elapsed}s)`);
    });

    await Promise.all(downloadTasks);
}

// 并行执行所有下载任务
if (SkipVersionList.includes(SING_BOX_VERSION)) {
    console.log(`Skipping download for version ${SING_BOX_VERSION}`);
    throw new Error(`Version ${SING_BOX_VERSION} is in the skip list.`);
} else {
    const scriptStartTime = Date.now();
    console.log('Starting parallel downloads...\n');

    Promise.all([
        downloadEmbeddingExternalBinaries(),
        downloadDatabaseFiles()
    ]).then(() => {
        const totalElapsed = ((Date.now() - scriptStartTime) / 1000).toFixed(2);
        console.log(`\n✓ All downloads completed! Total time: ${totalElapsed}s`);
    }).catch((error) => {
        const totalElapsed = ((Date.now() - scriptStartTime) / 1000).toFixed(2);
        console.error(`\n✗ Download failed after ${totalElapsed}s:`, error);
    });
}