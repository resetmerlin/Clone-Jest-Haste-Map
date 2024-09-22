import { isAbsolute } from "path";
import { pathToFileURL } from "url";

export default async function requireOrImportModule<T>(
  filePath: string,
  applyInteroRequireDefault = true
) {
  if (!isAbsolute(filePath) && filePath[0] === ".") {
    throw new Error(
      `Jest Haste Map: requireOrImportModule path must be absolute, was "${filePath}"`
    );
  }

  try {
    const requiredModule = require(filePath);
    if (!applyInteroRequireDefault) {
      return requiredModule;
    }
    return interopRequireDefault(requiredModule).default;
  } catch (error: any) {
    /** If you try to use the require statement to import an ES Module, it will throw Error */
    if (error.code === "ERR_REQUIRE_ESM") {
      try {
        const moduleUrl = pathToFileURL(filePath);

        // node 'import()' supports URL, but TypeScript doesn't know that
        const importedModule = await import(
          /** webpackIgnore: true */ moduleUrl.href
        );

        if (!applyInteroRequireDefault) {
          return importedModule;
        }

        if (!importedModule.default) {
          throw new Error(
            `Jest Haste Map: Failed to load ESM at ${filePath} - did you use a default export?`
          );
        }

        return importedModule.default;
      } catch (innerError: any) {
        if (innerError.message === "Not supported") {
          throw new Error(
            `Jest Haste Map: Your version of Node does not support dynamic import - please enable it or use a .cjs file extension for file ${filePath} `
          );
        }

        throw innerError;
      }
    } else {
      throw error;
    }
  }
}
function interopRequireDefault(obj: any): any {
  return obj && obj.__esModule ? obj : { default: obj };
}
