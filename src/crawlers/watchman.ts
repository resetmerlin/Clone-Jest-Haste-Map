import watchman = require("fb-watchman");
import * as path from "path";

type WatchmanRoots = Map<string, Array<string>>;

type WatchmanCapabilityCheckResponse = {
  // { 'suffix-set': true }
  capabilities: Record<string, boolean>;
  // '2021.06.07.00'
  version: string;
};

type WatchmanWatchProjectResponse = {
  watch: string;
  relative_path: string;
};

type WatchmanQueryResponse = {
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

export async function watchmanCrawl(options: any) {
  const fields = ["name", "exists", "mtime_ms", "size"];

  const { data, extensions, ignore, rootDir, roots } = options;

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

  /**
   * A bundler can have more than one root or entry point
   */
  async function getWathmanRoots(roots: Array<string>): Promise<WatchmanRoots> {
    const watchmanRootsHash = new Map();
    await Promise.all(
      roots.map(async (root) => {
        const response = await cmd<WatchmanWatchProjectResponse>(
          "watch-project",
          root
        );

        const existing = watchmanRootsHash.get(response.watch);

        // A root can only be filtered if it was never seen with a
        // relative_path before.
        const areWeAlreadyWatchingRoot = !existing || existing.length > 0;

        if (areWeAlreadyWatchingRoot === true) {
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
        const glob = [];

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

        const response = await cmd<WatchmanQueryResponse>("query", root, query);

        if ("warning" in response) {
          console.warn("watchman warning", response.warning);
        }

        const isSourceControlQuery = typeof since!;
      })
    );
  }

  let files = data.files;
  let removedFiles = new Map();
  const changedFiles = new Map();
  let results: Map<string, WatchmanQueryResponse>;
  let isFresh = false;

  try {
    const watchmanRoots = await getWathmanRoots(roots);
  } finally {
  }
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
