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
    const fileExtension = platform === 'windows' ? 'zip' : 'tar.gz';
    const fileName = `${BINARY_NAME}-${platform}-${arch}.${fileExtension}`;
    const downloadUrl = `${GITHUB_RELEASE_URL}${SING_BOX_VERSION}/${BINARY_NAME}-${SING_BOX_VERSION.substring(1)}-${platform}-${arch}.${fileExtension}`;
    const tmpDir = path.join(__dirname, 'tmp');
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

        console.log(`${platform}-${arch} version processed successfully`);
    } catch (error) {
        console.error('Processing failed:', error);
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

            // Download sysproxy for Windows amd64
            if (platform === 'windows' && arch === 'amd64') {
                console.log('Downloading Windows sysproxy...');
                const targetPath = `src-tauri/binaries/sysproxy-${targetTriple}${extension}`;

                // Ensure target directory exists
                const targetDir = path.dirname(targetPath);
                !fs.existsSync(targetDir) && fs.mkdirSync(targetDir, { recursive: true });

                await downloadFile(SYSPROXY_URL, targetPath);
                console.log('sysproxy download completed');
            }
        }
    }
}

if (SkipVersionList.includes(SING_BOX_VERSION)) {
    console.log(`Skipping download for version ${SING_BOX_VERSION}`);
    throw new Error(`Version ${SING_BOX_VERSION} is in the skip list.`);

} else {
    downloadEmbeddingExternalBinaries().catch(console.error);

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

    for (const dbFile of dbFiles) {
        const destPath = path.join(resourcesDir, dbFile.name);
        console.log(`Downloading database file: ${dbFile.name}...`);
        await downloadFile(dbFile.url, destPath);
        console.log(`Downloaded database file to: ${destPath}`);
    }
}

downloadDatabaseFiles().catch(console.error);