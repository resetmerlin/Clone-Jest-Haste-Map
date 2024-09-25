export type WatchmanRoots = Map<string, Array<string>>;

export type WatchmanCapabilityCheckResponse = {
  // { 'suffix-set': true }
  capabilities: Record<string, boolean>;
  // '2021.06.07.00'
  version: string;
};

export type WatchmanListCapabilitiesResponse = {
  capabilities: Array<string>;
};

export type WatchmanWatchProjectResponse = {
  watch: string;
  relative_path: string;
};

export type WatchmanQueryResponse = {
  warning?: string;
  is_fresh_instance: boolean;
  version: string;
  clock:
    | string
    | {
        scm: { "mergebase-with": string; mergebase: string };
        clock: string;
      };
  files: Array<{
    name: string;
    exists: boolean;
    mtime_ms: number | { toNumber: () => number };
    size: number;
    "content.sha1hex"?: string;
  }>;
};

export type FileMetaData = [
  id: string,
  mtime: number,
  size: number,
  visited: 0 | 1,
  dependencies: string,
  sha1: string | null | undefined
];
export type MockData = Map<string, string>;
export type ModuleMetaData = [path: string, type: number];
export type ModuleMapItem = { [platform: string]: ModuleMetaData };
export type ModuleMapData = Map<string, ModuleMapItem>;
export type WatchmanClockSpec = string | { scm: { "mergebase-with": string } };
export type WatchmanClocks = Map<string, WatchmanClockSpec>;
export type DuplicatesSet = Map<string, /* type */ number>;
export type DuplicatesIndex = Map<string, Map<string, DuplicatesSet>>;
export type FileData = Map<string, FileMetaData>;

export type WorkerMetadata = {
  dependencies: Array<string> | undefined | null;
  id: string | undefined | null;
  module: ModuleMetaData | undefined | null;
  sha1: string | undefined | null;
};

export type InternalHasteMap = {
  clocks: WatchmanClocks;
  duplicates: DuplicatesIndex;
  files: FileData;
  map: ModuleMapData;
  mocks: MockData;
};

export type CrawlerOptions = {
  computeSha1: boolean;
  data: InternalHasteMap;
  extensions: Array<string>;
  rootDir: string;
  roots: Array<string>;
};

export type HType = {
  ID: 0;
  MTIME: 1;
  SIZE: 2;
  VISITED: 3;
  DEPENDENCIES: 4;
  SHA1: 5;
  PATH: 0;
  TYPE: 1;
  MODULE: 0;
  PACKAGE: 1;
  GENERIC_PLATFORM: "g";
  NATIVE_PLATFORM: "native";
  DEPENDENCY_DELIM: "\0";
};

export type HasteImpl = {
  getHasteName(filePath: string): string | undefined;
};

export type WorkerMessage = {
  computeDependencies: boolean;
  computeSha1: boolean;
  dependencyExtractor?: string | null;
  rootDir: string;
  filePath: string;
  hasteImplModulePath?: string;
  retainAllFiles?: boolean;
};

export type DependencyExtractor = {
  extract: (
    code: string,
    filePath: string,
    defaultExtract: DependencyExtractor["extract"]
  ) => Iterable<string>;
  getCacheKey?: () => string;
};
