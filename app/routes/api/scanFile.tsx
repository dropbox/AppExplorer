import type { LoaderFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import invariant from "tiny-invariant";
import type { ScanData } from "~/chart";
import { linterScanFile } from "~/linter";
import {
  classComponentScanner,
  functionComponentScanner,
  lazyScanner,
} from "~/scanner/react-component-scanners";
import { scanFile } from "~/scanner/scanner.server";

/**
 * This API route only returns JSON from a loader. It uses scanFile
 * and composes a set of scanners together.
 *
 * If I want a scanner that's just a subset, like maybe I fetch the annotations
 * separately, or make a different scanner powered by Bazel, it can just be
 * another route.
 *
 * @AppExplorer
 * @param param0
 * @returns
 */
export const loader: LoaderFunction = async ({ request }) => {
  const url = new URL(request.url);

  const path = url.searchParams.get("path");
  invariant(path, "path required");

  const { jsDoc } = await linterScanFile(path);

  const scanResult = await scanFile<ScanData>(
    path,
    [lazyScanner, functionComponentScanner, classComponentScanner],
    {
      hash: "",
      remote: "",
      exports: [],
      components: {},
      jsDoc,
    }
  );
  invariant(scanResult);

  return json<ScanData>(scanResult);
};
