import * as path from "path";

let normalizePathSep: (string: string) => string;

if (path.sep === "/") {
  normalizePathSep = (filePath: string): string => filePath;
} else {
  normalizePathSep = (filePath: string): string =>
    filePath.replaceAll("/", path.sep);
}

export default normalizePathSep;
