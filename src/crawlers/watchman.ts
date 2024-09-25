import watchman = require("fb-watchman");
import * as path from "path";
import normalizePathSep from "../lib/normalizePathSep";
import {
  CrawlerOptions,
  FileData,
  FileMetaData,
  InternalHasteMap,
  WatchmanCapabilityCheckResponse,
  WatchmanListCapabilitiesResponse,
  WatchmanQueryResponse,
  WatchmanRoots,
  WatchmanWatchProjectResponse,
} from "../types";
import { H } from "../constants";

export async function watchmanCrawl(options: CrawlerOptions): Promise<{
  changedFiles?: FileData;
  removedFiles: FileData;
  hasteMap: InternalHasteMap;
}> {
  const fields = ["name", "exists", "mtime_ms", "size"];

  const { data, extensions, rootDir, roots } = options;

  /**
   * This variable is used for the suffix-set
   * This second form can be accelerated and is preferred over an anyof construction.
   * In the following example the two terms are functionally equivalent but the set form has a more efficient and thus faster runtime:
   *
   * ["anyof", ["suffix", "php"], ["suffix", "html"]]
   * ["suffix", ["php", "html"]]
   */
  const defaultWatchExpression: Array<any> = ["allof", ["type", "f"]];

  /**
   * The primary purpose of a clock is to allow Watchman to efficiently monitor
   * and detect changes to files and directories. When a client queries Watchman to check for changes,
   * it uses the clock value to ask for all changes since that clock.
   * This mechanism makes Watchman highly efficient in tracking filesystem changes
   * without having to scan all files every time.
   */
  const clocks = data.clocks;
  const client = new watchman.Client();

  /**
   * @link https://facebook.github.io/watchman/docs/capabilities.html
   * watchman has been used in production since a few weeks after it was first written,
   * and thus it has always made an effort to be backward compatible across releases and platforms.
   */
  const capabilities = await capabilityCheck(client, {
    /**
     * @link https://facebook.github.io/watchman/docs/expr/suffix#suffixset
     * The capability name associated with this enhanced functionality is suffix-set.
     */
    optional: ["suffix-set"],
  });

  if (capabilities?.capabilities["suffix-set"]) {
    /**
     * Remember the extensions is the language of your application, like react js, ts etc..
     * Use optimized operation
     * @example: ["suffix", ["php", "html"]]
     */
    defaultWatchExpression.push(["suffix", extensions]);
  } else {
    /**
     * Otherwise use the older and less optimal suffix tuple array
     * @example: ["anyof", ["suffix", "php"], ["suffix", "html"]]
     */
    defaultWatchExpression.push([
      "anyof",
      ...extensions.map((extension) => ["suffix", extension]),
    ]);
  }

  let clientError;
  client.on("error", (error) => (clientError = watchmanError(error)));

  /**
   * @link https://facebook.github.io/watchman/docs/nodejs#clientcommandargs--done
   *
   * The reason of making as a function is becauase for the reusability
   */
  const cmd = <T>(...args: Array<any>): Promise<T> =>
    new Promise((resolve, reject) =>
      client.command(args, (error, result) => {
        return error ? reject(watchmanError(error)) : resolve(result);
      })
    );

  if (options.computeSha1) {
    /**
     * This command returns the full list of supported capabilities offered by the watchman server.
     * The intention is that client applications will use the expanded version command
     * to check compatibility rather than interrogating the full list.
     */
    const { capabilities } = await cmd<WatchmanListCapabilitiesResponse>(
      "list-capabilities"
    );

    if (capabilities.includes("field-content.sha1hex")) {
      fields.push("content.sha1hex");
    }
  }
  /**
   * Based on the root that you provide, the watchman will watch the root and then
   * retrieves hash map value of root dir and relative dir
   */
  async function getWathmanRoots(roots: Array<string>): Promise<WatchmanRoots> {
    const watchmanRootsHash = new Map();
    await Promise.all(
      roots.map(async (root) => {
        /**
         * If the root that you wanna watch is '/root-mock/fruits',
         * watch '/root-mock' and get relative path which is fruits
         */
        const response = await cmd<WatchmanWatchProjectResponse>(
          "watch-project",
          root
        );

        const existing = watchmanRootsHash.get(response.watch);

        // A root can only be filtered if it was never seen with a
        // relative_path before.
        const areWeWatchingRootFirstTime = !existing || existing.length > 0;

        if (areWeWatchingRootFirstTime === true) {
          if (response.relative_path) {
            watchmanRootsHash.set(response.watch, [
              ...(existing || []),
              response.relative_path,
            ]);
          } else {
            watchmanRootsHash.set(response.watch, []);
          }
        }
      })
    );

    return watchmanRootsHash;
  }

  async function queryWatchmanForDirs(rootProjectDirMappings: WatchmanRoots) {
    const results = new Map<string, WatchmanQueryResponse>();

    let isFresh = false;

    await Promise.all(
      [...rootProjectDirMappings].map(async ([root, directoryFilters]) => {
        const expression = [...defaultWatchExpression];
        /**
         * This variable is to store glob pattern.
         */
        const glob = [];

        // If the root directory that you chose has child directory.
        // example: '/root-mock/fruits'
        if (directoryFilters.length > 0) {
          expression.push([
            "anyof",
            ...directoryFilters.map((dir) => ["dirname", dir]),
          ]);

          for (const directory of directoryFilters) {
            for (const extension of extensions) {
              glob.push(`${directory}/**/*.${extension}`);
            }
          }
        } else {
          for (const extension of extensions) {
            glob.push(`**/*.${extension}`);
          }
        }

        // Jest is only going to store one type of clock; a string that
        // represents a local clock. However, the Watchman crawler supports
        // a second type of clock that can be written by automation outside of
        // Jest, called an "scm query", which fetches changed files based on
        // source control mergebases. The reason this is necessary is because
        // local clocks are not portable across systems, but scm queries are.
        // By using scm queries, we can create the haste map on a different
        // system and import it, transforming the clock into a local clock.
        const since = clocks.get(path.relative(rootDir, root));

        /**
         * Finds all files that were modified since the specified clockspec
         * that match the optional list of patterns. If no patterns are specified, all modified files are returned.
         * The primary purpose of using since is to optimize file system monitoring by avoiding redundant checks.
         * It allows clients to query Watchman for only the changes that occurred after a previous query,
         * rather than retrieving the entire state of the filesystem or all files.
         */
        const query =
          since === undefined
            ? // use the 'since' generator if we have a clock available
              { expression, fields, glob, glob_includedotfiles: true }
            : // Otherwise use the 'glob' filter
              { expression, fields, since };

        /**
         * A Watchman query is a command used to request information from the Watchman service about changes
         * to files and directories that it is monitoring. Watchman, a tool developed by Facebook,
         * watches files and directories for changes and sends notifications when those changes are detected.
         * The query feature allows you to efficiently check for file changes, get lists of modified files,
         * and perform other operations related to file and directory state.
         */
        const response = await cmd<WatchmanQueryResponse>("query", root, query);

        if ("warning" in response) {
          console.warn("watchman warning", response.warning);
        }

        // When a source-control query is used, we ignore the "is fresh"
        // response from Watchman because it will be true despite the query
        // being incremental.
        const isSourceControlQuery =
          typeof since !== "string" &&
          since?.scm?.["mergebase-with"] !== undefined;

        if (!isSourceControlQuery) {
          isFresh = isFresh || response.is_fresh_instance;
        }

        results.set(root, response);
      })
    );

    return {
      isFresh,
      results,
    };
  }

  let files = data.files;
  let removedFiles = new Map();
  const changedFiles = new Map();
  let results: Map<string, WatchmanQueryResponse>;
  let isFresh = false;

  try {
    const watchmanRoots = await getWathmanRoots(roots);
    const watchmanFileResults = await queryWatchmanForDirs(watchmanRoots);

    // Reset the file map if watchman was restarted and sends us a list of files
    if (watchmanFileResults.isFresh) {
      files = new Map();
      removedFiles = new Map(data.files);
      isFresh = true;
    }

    results = watchmanFileResults.results;
  } finally {
    client.end();
  }

  if (clientError) {
    throw clientError;
  }

  for (const [watchRoot, response] of results) {
    const fsRoot = normalizePathSep(watchRoot);
    const relativeFsRoot = path.relative(rootDir, fsRoot);

    clocks.set(
      relativeFsRoot,
      // Ensure we persist only the local clock if it is not string, it could be
      // SCM query result. so get clock property of that object
      typeof response.clock === "string" ? response.clock : response.clock.clock
    );

    for (const fileData of response.files) {
      const filePath = fsRoot + path.sep + normalizePathSep(fileData.name);
      const relativeFilePath = path.relative(rootDir, filePath);
      const existingFileData = data.files.get(relativeFilePath);

      // If watchman is fresh, the removed files map starts with all files
      // and we remove them as we verify they still exist.
      if (isFresh && existingFileData && fileData.exists) {
        removedFiles.delete(relativeFilePath);
      }

      /**
       * If the watched file data is somehow deleted
       */
      if (!fileData.exists) {
        /**
         * We don't have to act on the files that is deleted and were not tracked
         */
        if (existingFileData) {
          files.delete(relativeFilePath);

          /**
           * If watchman is not refreshed, we have to know what file has been deleted
           */
          if (!isFresh) {
            removedFiles.set(relativeFilePath, existingFileData);
          }
        }
      } else if (filePath) {
        const mtime =
          typeof fileData.mtime_ms === "number"
            ? fileData.mtime_ms
            : fileData.mtime_ms.toNumber();

        const size = fileData.size;

        let sha1hex = fileData["content.sha1hex"];

        if (typeof sha1hex !== "string" || sha1hex.length !== 40) {
          sha1hex = undefined;
        }

        let nextData: FileMetaData;

        if (existingFileData && existingFileData[H.MTIME] === mtime) {
          nextData = existingFileData;
        } else if (
          existingFileData &&
          sha1hex &&
          existingFileData[H.SHA1] === sha1hex
        ) {
          nextData = [
            existingFileData[0],
            mtime,
            existingFileData[2],
            existingFileData[3],
            existingFileData[4],
            existingFileData[5],
          ];
        } else {
          nextData = ["", mtime, size, 0, "", sha1hex ?? null];
        }

        files.set(relativeFilePath, nextData);
        changedFiles.set(relativeFilePath, nextData);
      }
    }
  }

  data.files = files;

  return {
    changedFiles: isFresh ? undefined : changedFiles,
    hasteMap: data,
    removedFiles,
  };
}

/**
 * Wrap watchman capability check method as a promise
 *
 * @param client watchman client
 * @param caps capabilities to verify
 * @returns a promise resolving to a list of verifies capabilities
 */
async function capabilityCheck(
  client: watchman.Client,
  caps: Partial<watchman.Capabilities>
): Promise<WatchmanCapabilityCheckResponse> {
  return new Promise((resolve, reject) => {
    // @ts-expect-error: incorrectly typed
    client.capabilityCheck(caps, (error, response) => {
      if (error) {
        reject(error);
      } else {
        resolve(response);
      }
    });
  });
}

const watchmanURL = "https://facebook.github.io/watchman/docs/troubleshooting";

function watchmanError(error: Error): Error {
  error.message =
    `Watchman error: ${error.message.trim()}. Make sure watchman ` +
    `is running for this project. See ${watchmanURL}.`;
  return error;
}
