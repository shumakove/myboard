// Приёмка T5.6 · схемы uml/ разбираются Mermaid без ошибок (блок «Тестирование» T5.6).
// Каталог схем — UML_DIR или uml/ репозитория; разбор — mermaid.parse в браузере.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures';

const here = dirname(fileURLToPath(import.meta.url));
const umlDir = resolve(process.env.UML_DIR ?? join(here, '..', '..', 'uml'));

function mdFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? mdFiles(p) : n.endsWith('.md') ? [p] : [];
  });
}

test('UML every mermaid block in uml/ parses without errors', async ({ page, isMobile }) => {
  test.skip(isMobile, 'не зависит от профиля');
  const blocks = mdFiles(umlDir).flatMap((f) =>
    [...readFileSync(f, 'utf8').matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m, i) => ({ where: `${relative(umlDir, f)}#${i + 1}`, code: m[1] })),
  );
  expect(blocks.length, `блоки mermaid в ${umlDir}`).toBeGreaterThan(0);
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ path: createRequire(import.meta.url).resolve('mermaid/dist/mermaid.min.js') });
  const errors = await page.evaluate(async (blocks) => {
    const m = (window as unknown as { mermaid: { initialize: (o: object) => void; parse: (c: string) => Promise<unknown> } }).mermaid;
    m.initialize({ startOnLoad: false });
    const out: string[] = [];
    for (const b of blocks) {
      try {
        await m.parse(b.code);
      } catch (e) {
        out.push(`${b.where}: ${String((e as Error).message ?? e).split('\n').slice(0, 3).join(' ')}`);
      }
    }
    return out;
  }, blocks);
  test.info().annotations.push({ type: 'схемы', description: `${blocks.length} блоков` });
  expect(errors).toEqual([]);
});
