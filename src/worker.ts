import { createHash } from "crypto";
import * as path from "path";
import * as fs from "graceful-fs";
import { HasteImpl, WorkerMessage, WorkerMetadata } from "./types";
import { H } from "./constants";
import blacklists from "./blacklists";
import requireOrImportModule from "./utils";
import { extractor as defaultDependencyExtractor } from "./lib/dependencyExtractor";

const PACKAGE_JSON = `${path.sep}package.json`;

let hasteImpl: HasteImpl | null = null;
let hasteImplModulePath: string | null = null;

function sha1hex(content: string | Buffer): string {
  return createHash("sha1").update(content).digest("hex");
}

export async function worker(data: WorkerMessage) {
  if (
    data.hasteImplModulePath &&
    data.hasteImplModulePath !== hasteImplModulePath
  ) {
    if (hasteImpl) {
      throw new Error("jest-haste-map: hasteImplModulePath changed");
    }

    hasteImplModulePath = data.hasteImplModulePath;
    hasteImpl = require(hasteImplModulePath);
  }

  let content: string | undefined;
  let dependencies: WorkerMetadata["dependencies"];
  let id: WorkerMetadata["id"];
  let module: WorkerMetadata["module"];
  let sha1: WorkerMetadata["sha1"];

  const { computeDependencies, computeSha1, rootDir, filePath } = data;

  const getContent = (): string => {
    if (content === undefined) {
      content = fs.readFileSync(filePath, "utf-8");
    }

    return content;
  };

  if (filePath.endsWith(PACKAGE_JSON)) {
    // Process a package.json that is returned as a PACKAGE type with its name
    try {
      const fileData = JSON.parse(getContent());

      if (fileData.name) {
        const relativeFilePath = path.relative(rootDir, filePath);

        id = fileData.name;
        module = [relativeFilePath, H.PACKAGE];
      }
    } catch (error: any) {
      throw new Error(`Cannot parse ${filePath} as JSON: ${error.message}`);
    }
  } else if (!blacklists.has(filePath.slice(filePath.lastIndexOf(".")))) {
    // Process as random file that is returned as a Module
    if (hasteImpl) {
      id = hasteImpl.getHasteName(filePath);
    }

    if (computeDependencies) {
      const content = getContent();
      const extractor = data.dependencyExtractor
        ? await requireOrImportModule(data.dependencyExtractor, false)
        : defaultDependencyExtractor;

      dependencies = [
        ...extractor.extract(
          content,
          filePath,
          defaultDependencyExtractor.extract
        ),
      ];
    }
  }
}
