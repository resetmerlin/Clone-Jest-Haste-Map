import {EventEmitter as $hgUW1$EventEmitter} from "events";
import {cpus as $hgUW1$cpus} from "os";




const $149c1bd638913645$var$VCS_DIRECTORIES = "/\\.git/|/\\.hg/|/\\.sl/";
class $149c1bd638913645$var$HasteMap extends (0, $hgUW1$EventEmitter) {
    static async create(options) {
        const hasteMap = new $149c1bd638913645$var$HasteMap(options);
        return hasteMap;
    }
    constructor(options){
        super();
        this._options = {
            extensions: options.extensions,
            maxWorkers: options.maxWorkers,
            name: options.name,
            platforms: options.platforms,
            rootDir: options.rootDir,
            roots: this.removeDuplicates(options.roots)
        };
        this._console = options.console || globalThis.console;
        this._options.ignorePattern = new RegExp($149c1bd638913645$var$VCS_DIRECTORIES);
    }
    async setupCachePath(options) {
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
     */ const rootDirHash = (0, $149c1bd638913645$import$7effb53edfc7fa2d$2fb37efbf6ae0c0e)("sha1").update(options.rootDir).digest("hex").slice(0, 32);
        let hasteImplHash = "";
        let dependencyExtractorHash = "";
    }
    removeDuplicates(unstableLists) {
        return [
            ...new Set(unstableLists)
        ];
    }
}
const $149c1bd638913645$var$hasteMapOptions = {
    extensions: [
        "js"
    ],
    maxWorkers: (0, $hgUW1$cpus)().length,
    name: "jest-bundler",
    platforms: [],
    rootDir: "/",
    roots: [
        "/"
    ]
};
console.log($149c1bd638913645$var$HasteMap.create($149c1bd638913645$var$hasteMapOptions));


//# sourceMappingURL=module.js.map
