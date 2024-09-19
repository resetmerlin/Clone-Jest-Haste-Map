export const H = {
  /* dependency serialization */
  DEPENDENCY_DELIM: "\0",

  /* file map attributes */
  ID: 0,
  MTIME: 1,
  SIZE: 2,
  VISITED: 3,
  DEPENDENCIES: 4,
  SHA1: 5,

  /* module map attributes */
  PATH: 0,
  TYPE: 1,

  /* module types */
  MODULE: 0,
  PACKAGE: 1,

  /* platforms */
  GENERIC_PLATFORM: "g",
  NATIVE_PLATFORM: "native",
};
