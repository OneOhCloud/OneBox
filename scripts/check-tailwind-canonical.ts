#!/usr/bin/env bun
/**
 * Enforce "prefer Tailwind canonical classes over arbitrary px values on
 * spacing-scale-backed properties" for px values small enough that the
 * canonical form stays idiomatic. Above MAX_PX, the bracket form is kept
 * because `w-62.5` (from `w-[250px]`) is not more canonical than the
 * arbitrary value — it's arbitrary-feeling fractional in disguise.
 *
 * Why we don't delegate to @tailwindcss/language-server's
 * `suggestCanonicalClasses`: that diagnostic's cutoff is "any integer
 * divisible by the spacing unit", which produces fractional-looking
 * canonicals (w-62.5, w-62.75) for values the project considers
 * intentional design tokens. See tailwindlabs/tailwindcss-intellisense
 * issue #1527 for the upstream report.
 *
 * Usage:
 *   bun run scripts/check-tailwind-canonical.ts [--fix] [path...]
 *
 * Default path: src/ . Exit 0 on clean / all-fixed, exit 1 on remaining
 * violations. Wired into `.husky/pre-commit`.
 */

import { readFileSync, writeFileSync } from "node:fs";

const MAX_PX = 32;
const SPACING_UNIT = 4;

const PROPERTIES = [
    "min-w", "min-h", "max-w", "max-h",
    "size",
    "gap-x", "gap-y", "gap",
    "space-x", "space-y",
    "inset-x", "inset-y", "inset",
    "top", "right", "bottom", "left",
    "px", "py", "pt", "pr", "pb", "pl", "p",
    "mx", "my", "mt", "mr", "mb", "ml", "m",
    "w", "h",
];

const PATTERN = new RegExp(
    `(?<![\\w-])(-?(?:${PROPERTIES.join("|")}))-\\[(\\d+)px\\]`,
    "g",
);

type Hit = { file: string; line: number; col: number; raw: string; fix: string };

function scanFile(path: string, apply: boolean): Hit[] {
    const content = readFileSync(path, "utf-8");
    const hits: Hit[] = [];
    for (const m of content.matchAll(PATTERN)) {
        const [raw, prop, pxStr] = m;
        const px = parseInt(pxStr, 10);
        if (px > MAX_PX) continue;
        const fix = `${prop}-${px / SPACING_UNIT}`;
        const before = content.slice(0, m.index!);
        const line = (before.match(/\n/g)?.length ?? 0) + 1;
        const col = m.index! - (before.lastIndexOf("\n") + 1) + 1;
        hits.push({ file: path, line, col, raw, fix });
    }
    if (apply && hits.length > 0) {
        const replaced = content.replace(PATTERN, (full, prop, pxStr) => {
            const px = parseInt(pxStr, 10);
            return px > MAX_PX ? full : `${prop}-${px / SPACING_UNIT}`;
        });
        writeFileSync(path, replaced);
    }
    return hits;
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const fix = args.includes("--fix");
    const paths = args.filter((a) => !a.startsWith("--"));
    const scanPaths = paths.length > 0 ? paths : ["src"];

    const hits: Hit[] = [];
    for (const root of scanPaths) {
        const glob = new Bun.Glob("**/*.{ts,tsx,js,jsx}");
        for await (const file of glob.scan({ cwd: root })) {
            hits.push(...scanFile(`${root}/${file}`, fix));
        }
    }

    if (hits.length === 0) {
        console.log("[check-tailwind-canonical] OK");
        return;
    }

    for (const h of hits) {
        console.log(`${h.file}:${h.line}:${h.col}  ${h.raw}  →  ${h.fix}`);
    }
    if (fix) {
        console.log(`\n[check-tailwind-canonical] auto-fixed ${hits.length} occurrence(s)`);
        return;
    }
    console.log(
        `\n[check-tailwind-canonical] ${hits.length} occurrence(s) flagged. ` +
        `Rerun with --fix to apply (or run 'bun run check:tailwind:fix').`,
    );
    process.exit(1);
}

void main();
