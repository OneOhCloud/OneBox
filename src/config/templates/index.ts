import type { configType } from '../common';
import { BUILD_TIME_TEMPLATE_SOURCE, BUILT_IN_TEMPLATES } from './generated';

export { BUILD_TIME_TEMPLATE_SOURCE, BUILT_IN_TEMPLATES };

/**
 * ZH: 返回 build 时从 `conf-template` 仓库烘进来的模板 JSON 字符串。被两个
 *     路径共用：运行期 `merger/main.ts::getConfigTemplate` 在缓存为空时调用
 *     它做 seeding；SWR prime 路径在远端 fetch 失败时调用它作为 fallback。
 *     模板内容定义在 `conf-template` 仓库，本项目只做"最后一公里"的
 *     读取和分发。
 * EN: Returns the build-time snapshot of the config template JSON string for
 *     a given mode. Shared by two paths: the runtime reader in
 *     `merger/main.ts::getConfigTemplate` uses it to seed an empty cache,
 *     and the SWR prime path in `hooks/useSwr.ts` uses it as fallback when
 *     the remote fetch fails. Template content is owned by the
 *     `conf-template` repo; this project only handles last-mile delivery.
 */
export function getBuiltInTemplate(mode: configType): string {
    const template = BUILT_IN_TEMPLATES[mode];
    if (!template) {
        throw new Error(
            `[template] no built-in fallback for mode="${mode}" ` +
                `(snapshot from ${BUILD_TIME_TEMPLATE_SOURCE.repo}@${BUILD_TIME_TEMPLATE_SOURCE.branch} ` +
                `commit ${BUILD_TIME_TEMPLATE_SOURCE.commit.slice(0, 8)})`,
        );
    }
    return template;
}
