import { ESLint, Linter } from "eslint";
import * as fs from "fs/promises";
import * as nodePath from "path";
import type { JSDocReport } from "~/scanner/jsdoc-scanner";
import { identity } from "~/utils/identity";
import type { BoardPermalink } from "./at-app-explorer";
import { atAppExplorer } from "./at-app-explorer";
import { deserialize } from "./utils";

const REPO_ROOT: string = process.env.REPO_ROOT ?? process.cwd();

export async function linterScanFile(
  filePath: string,
  // If a node gets created on the board, then the LintMessage will be sent back
  // through this updatedResults.
  // Assuming no changes have been made between the scan and update, I should be
  // able to match them up by location.
  boardPermalinks: Array<BoardPermalink> = []
): Promise<JSDocReport> {
  const linter = new Linter({
    cwd: REPO_ROOT,
  });

  linter.defineRules({
    atAppExplorer: atAppExplorer as any,
  });
  const eslint = new ESLint({
    fix: true,
  });

  const config = await eslint.calculateConfigForFile(filePath);

  const sourceCode = await fs.readFile(nodePath.join(REPO_ROOT, filePath));

  if (config.parser) {
    linter.defineParser(config.parser, require(config.parser));
  }
  config.rules = {
    atAppExplorer: [
      1,
      {
        boardPermalinks,
      },
    ] as const,
  };

  const source = sourceCode.toString();
  const results = linter.verifyAndFix(source, config, filePath);
  results.fixed = results.output !== source;

  if (results.output !== source) {
    await fs.writeFile(nodePath.join(REPO_ROOT, filePath), results.output);
  }

  return results.messages.reduce((report: JSDocReport, m) => {
    switch (m.ruleId) {
      case "atAppExplorer":
        report.jsDoc.push(deserialize(m.ruleId, m.message));
    }
    return report;
  }, identity<JSDocReport>({ jsDoc: [] }));
}
