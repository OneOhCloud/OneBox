import type { configType } from '../common';
import { BUILD_TIME_TEMPLATE_SOURCE, BUILT_IN_TEMPLATE_OBJECTS } from './generated';

export { BUILD_TIME_TEMPLATE_SOURCE };

/**
 * ZH: 返回 build 时从 `conf-template` 仓库烘进来的模板的 JSON 字符串。
 *     `generated.ts` 里存的是真正的 TS 对象字面量（不是 JSON 字符串），
 *     这样 tsc 能直接校验语法；stringify 发生在这里，运行期只花一次。
 *     调用方（`merger/main.ts::getConfigTemplate` 和 SWR prime fallback）
 *     拿到字符串后存进 tauri-plugin-store，接口形态不变。
 * EN: Returns the build-time snapshot of the config template as a JSON
 *     string. The underlying `generated.ts` stores the templates as real
 *     TS object literals (not JSON strings), so tsc type-checks them
 *     directly and no weird string-escape bugs are possible at build time.
 *     We stringify here so the caller's string-based interface (which
 *     writes into tauri-plugin-store as a string blob) stays unchanged.
 *
 *     Template data is owned by the `conf-template` repo. This project
 *     only handles last-mile delivery — don't try to edit template
 *     content from here.
 */
export function getBuiltInTemplate(mode: configType): string {
    const template = BUILT_IN_TEMPLATE_OBJECTS[mode];
    if (template === undefined) {
        throw new Error(
            `[template] no built-in fallback for mode="${mode}" ` +
                `(snapshot from ${BUILD_TIME_TEMPLATE_SOURCE.repo}@${BUILD_TIME_TEMPLATE_SOURCE.branch} ` +
                `commit ${BUILD_TIME_TEMPLATE_SOURCE.commit.slice(0, 8)})`,
        );
    }
    return JSON.stringify(template);
}
