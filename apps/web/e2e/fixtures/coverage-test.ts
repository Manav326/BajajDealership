import { mkdir, writeFile } from 'node:fs/promises';
import { test as base, expect, type Page } from '@playwright/test';

type FunctionCoverage = {
  startOffset: number;
  endOffset: number;
  executed: boolean;
};

type ModuleCoverage = {
  url: string;
  functions: FunctionCoverage[];
};

// Capture Chromium's precise V8 function coverage for the application modules
// actually loaded by each browser test. This is intentionally not described as
// line coverage or whole-repository coverage.
export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const browser = page.context().browser();
    const isChromium = browser?.browserType().name() === 'chromium';
    if (!isChromium) {
      await use(page);
      return;
    }

    const session = await page.context().newCDPSession(page);
    let coverageStarted = false;
    try {
      await session.send('Profiler.enable');
      await session.send('Profiler.startPreciseCoverage', {
        callCount: false,
        detailed: true,
      });
      coverageStarted = true;
      await use(page);
    } finally {
      if (coverageStarted) {
        try {
          const response = await session.send('Profiler.takePreciseCoverage') as {
            result: Array<{
              url: string;
              functions: Array<{
                ranges: Array<{ startOffset: number; endOffset: number; count: number }>;
              }>;
            }>;
          };
          const modules: ModuleCoverage[] = response.result
            .filter((script) => script.url.includes('/src/') && !script.url.includes('/node_modules/'))
            .map((script) => {
              let url = script.url;
              try {
                const parsed = new URL(url);
                url = parsed.origin + parsed.pathname;
              } catch {
                // Keep the raw V8 URL when it is not an absolute URL.
              }
              return {
                url,
                functions: script.functions
                  .filter((fn) => fn.ranges.length > 0)
                  .map((fn) => ({
                    startOffset: fn.ranges[0].startOffset,
                    endOffset: fn.ranges[0].endOffset,
                    executed: fn.ranges.some((range) => range.count > 0),
                  })),
              };
            });
          const output = testInfo.outputPath('v8-function-coverage.json');
          await mkdir(testInfo.outputDir, { recursive: true });
          await writeFile(output, JSON.stringify({
            testTitle: testInfo.title,
            project: testInfo.project.name,
            modules,
          }, null, 2), 'utf8');
          await testInfo.attach('v8-function-coverage', {
            path: output,
            contentType: 'application/json',
          });
        } catch (error) {
          // Coverage reporting must never mask the actual UI-test result.
          console.warn('Could not persist V8 function coverage:', error);
        } finally {
          await session.send('Profiler.stopPreciseCoverage').catch(() => undefined);
        }
      }
      await session.detach().catch(() => undefined);
    }
  },
});

export { expect };
export type { Page };
