import { EventEmitter } from "events";
import { cpus, tmpdir } from "os";
import { createHash } from "crypto";
import * as path from "path";
import { deserialize, serialize } from "v8";
import * as fs from "fs";
import {
  CrawlerOptions,
  FileData,
  InternalHasteMap,
  watchmanCrawl,
} from "./crawlers/watchman";

type Options = {
  computeSha1?: boolean;
  console?: Console;
  extensions: Array<string>;
  ignorePattern?: RegExp;
  maxWorkers: number;
  platforms: Array<string>;
  rootDir: string;
  roots: Array<string>;
  name?: string;
  cacheDirectory?: string;
  id: string;
  resetCache?: boolean;
};

type InternalOptions = {
  computeSha1: boolean;
  extensions: Array<string>;
  ignorePattern?: RegExp;
  maxWorkers: number;
  platforms: Array<string>;
  rootDir: string;
  roots: Array<string>;
  name?: string;
  cacheDirectory: string;
  id: string;
  resetCache?: boolean;
  useWatchman?: boolean;
};

const VCS_DIRECTORIES = "/\\.git/|/\\.hg/|/\\.sl/";

class HasteMap extends EventEmitter {
  private readonly _options: InternalOptions;
  private readonly _console: Console;
  private _cachePath = "";
  private _buildPromise: any = null;

  static async create(options: Options) {
    const hasteMap = new HasteMap(options);

    return hasteMap;
  }

  private constructor(options: Options) {
    super();
    this._options = {
      computeSha1: options.computeSha1 || false,
      cacheDirectory: options.cacheDirectory || tmpdir(),
      extensions: options.extensions,
      maxWorkers: options.maxWorkers,
      name: options.name,
      platforms: options.platforms,
      rootDir: options.rootDir,
      roots: this.removeDuplicates(options.roots),
      id: options.id,
      resetCache: options.resetCache,
    };

    this._console = options.console || globalThis.console;

    this._options.ignorePattern = new RegExp(VCS_DIRECTORIES);
    /**
     * We alawys uses watchman without relying on native node fs watch
     * Watchman exists to watch files and record when they change. It can also trigger actions (such as rebuilding assets) when matching files change.
     * @link https://engineering.fb.com/2013/05/30/core-infra/watchman-faster-builds-with-large-source-trees/
     */
    this._options.useWatchman = true;
  }

  private async setupCachePath(options: Options): Promise<void> {
    /**
     * SHA-1 is a cryptographic hash function that takes an input (or message) and returns a fixed-size,
     * 160-bit (20-byte) hash value. It's commonly represented as a hexadecimal number.
     *
     * SHA-1 was once a popular cryptographic hash function used in various security protocols, such as TLS, SSL, and digital signatures.
     * However, it is now considered weak and insecure due to vulnerabilities that allow attackers to perform collision attacks (where two different inputs produce the same hash).
     *
     * But SHA-1 is relatively fast to compute compared to more secure hash functions like SHA-256 or SHA-512.
     * Jest Haste Map uses SHA-1 to generate hashes of file contents or paths. This hashing is done frequently and needs to be as performant as possible. Since SHA-1 is faster,
     * it reduces the overhead involved in computing these hashes, allowing Jest to efficiently detect file changes and keep its internal state updated.
     *
     * Jest Haste Map uses SHA-1 hashes mainly to create unique identifiers for files.
     * The primary goal here is to quickly and uniquely represent a file's content or path, not to secure data against cryptographic attacks
     */
    const rootDirHash = createHash("sha1")
      .update(options.rootDir)
      .digest("hex")
      .slice(0, 32);

    const extra = [
      this._options.id,
      this._options.roots
        .map((root) => path.relative(options.rootDir, root))
        .join(":"),
    ];

    this._cachePath = HasteMap.getCacheFilePath(
      this._options.cacheDirectory,
      `haste-map-${this._options.id}-${rootDirHash}`,
      ...extra
    );
  }

  static getCacheFilePath(
    tmpdir: string,
    id: string,
    ...extra: string[]
  ): string {
    const hash = createHash("sha1").update(extra.join(""));

    /**
     * Replace non word character, if the id is like "hello@world:2024",
     * change it into "hello-world-2024"
     */
    const replacedNonWordCharacter = id.replaceAll(/\W/g, "-");

    return path.join(
      tmpdir,
      `${replacedNonWordCharacter}-${hash.digest("hex").slice(0, 32)}`
    );
  }

  removeDuplicates(unstableLists: Array<any>) {
    return [...new Set(unstableLists)];
  }

  getCacheFilePath(): string {
    return this._cachePath;
  }

  build() {
    if (!this._buildPromise) {
      this._buildPromise = async () => {
        const data = await this._buildFileMap();

        // Persist when we don't know if files changed (changedFiles undefined)
        // or when we know a file was changed or deleted.
        let hasteMap: InternalHasteMap;

        if (
          data.changedFiles === undefined ||
          data.changedFiles.size > 0 ||
          data.removedFiles.size > 0
        ) {
          hasteMap = await this._buildHasteMap(data);
        }
      };
    }
  }

  private _buildHasteMap(data: {
    removedFiles: FileData;
    changedFiles?: FileData;
    hasteMap: InternalHasteMap;
  }) {
    const { removedFiles, changedFiles, hasteMap } = data;

    // If any files were removed or we did not track what files changed, process
    // every file looking for changes, Otherwise, process only changed files.
    let map;
    let mocks;
    let filesToProcess;

    if (changedFiles === undefined || removedFiles.size > 0) {
      map = hasteMap.map;
      mocks = hasteMap.mocks;
      filesToProcess = changedFiles;
    }
  }
  /**
   * 2. crawl the file system.
   */
  private async _buildFileMap() {
    let hasteMap;
    try {
      const read = this._options.resetCache ? this._createEmptyMap : this.read;
      hasteMap = read.call(this);
    } catch (error) {
      hasteMap = this._createEmptyMap();
    }

    return this._crawl(hasteMap);
  }

  private async _crawl(hasteMap: InternalHasteMap) {
    const options = this._options;

    const crawl = watchmanCrawl;

    const crawlerOptions: CrawlerOptions = {
      computeSha1: options.computeSha1,
      data: hasteMap,
      extensions: options.extensions,
      rootDir: options.rootDir,
      roots: options.roots,
    };

    const retry = (retryError: Error) => {
      this._console.warn(
        "jest-haste-map: Watchman crawl failed. \n" +
          "Usually this happens when watchman isn't running. Create an " +
          "empty `.watchmanconfig` file in your project's root folder or " +
          "initialize a git or hg repository in your project. \n" +
          `  ${retryError}`
      );

      throw retryError;
    };

    try {
      return await crawl(crawlerOptions);
    } catch (error: any) {
      return retry(error);
    }
  }

  /**
   * 1. read data from the cache or create an empty structure.
   */
  read() {
    let hasteMap;

    try {
      hasteMap = deserialize(fs.readFileSync(this._cachePath));
    } catch {
      hasteMap = this._createEmptyMap();
    }

    return hasteMap;
  }

  private _createEmptyMap() {
    return {
      clocks: new Map(),
      duplicates: new Map(),
      files: new Map(),
      map: new Map(),
      mocks: new Map(),
    };
  }
}

const hasteMapOptions = {
  extensions: ["js"],
  maxWorkers: cpus().length,
  name: "jest-bundler",
  platforms: [],
  rootDir: "/",
  roots: ["/"],
};
