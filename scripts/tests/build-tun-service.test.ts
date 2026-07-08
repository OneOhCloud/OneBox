import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnSyncMock = vi.fn();
const existsSyncMock = vi.fn();
const mkdirSyncMock = vi.fn();
const copyFileSyncMock = vi.fn();

vi.mock("node:child_process", () => ({
    spawnSync: (...args: unknown[]) => spawnSyncMock(...args),
}));

vi.mock("node:fs", () => ({
    copyFileSync: (...args: unknown[]) => copyFileSyncMock(...args),
    existsSync: (...args: unknown[]) => existsSyncMock(...args),
    mkdirSync: (...args: unknown[]) => mkdirSyncMock(...args),
}));

const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
const originalArgv = process.argv;

async function importBuildScript() {
    await import("../build-tun-service.ts");
}

describe("build-tun-service script", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "error").mockImplementation(() => {});
        vi.spyOn(process, "exit").mockImplementation((code) => {
            throw new Error(`process.exit ${code ?? 0}`);
        });

        Object.defineProperty(process, "platform", { value: "win32" });
        process.argv = ["deno", "run", "scripts/build-tun-service.ts"];

        spawnSyncMock.mockReset();
        existsSyncMock.mockReset();
        mkdirSyncMock.mockReset();
        copyFileSyncMock.mockReset();

        spawnSyncMock.mockImplementation((command: string) => {
            if (command === "cargo") {
                return { status: 0 };
            }

            if (command === "rustc") {
                return {
                    status: 0,
                    stdout: "rustc 1.90.0\nhost: x86_64-pc-windows-msvc\n",
                };
            }

            return { status: 1 };
        });
        existsSyncMock.mockReturnValue(true);
    });

    afterEach(() => {
        if (platformDescriptor) {
            Object.defineProperty(process, "platform", platformDescriptor);
        }
        process.argv = originalArgv;
        vi.restoreAllMocks();
    });

    it("stages the Windows dev tun-service binary for Tauri externalBin", async () => {
        await importBuildScript();

        const srcTauri = join(process.cwd(), "src-tauri");
        const builtBinary = join(srcTauri, "target", "debug", "tun-service.exe");
        const stagedBinary = join(
            srcTauri,
            "binaries",
            "tun-service-x86_64-pc-windows-msvc.exe",
        );

        expect(spawnSyncMock).toHaveBeenNthCalledWith(
            1,
            "cargo",
            ["build", "-p", "tun-service"],
            expect.objectContaining({ cwd: srcTauri }),
        );
        expect(existsSyncMock).toHaveBeenCalledWith(builtBinary);
        expect(mkdirSyncMock).toHaveBeenCalledWith(join(srcTauri, "binaries"), {
            recursive: true,
        });
        expect(copyFileSyncMock).toHaveBeenCalledWith(builtBinary, stagedBinary);
    });
});
