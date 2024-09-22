const extensions = new Set<string>([
  // JSONs are never hsate modules, except for "package.json", which is handled
  ".json",

  // Image extensions
  ".bmp",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".tiff",
  ".tif",
  ".webp",

  // Video extensions
  ".avi",
  ".mp4",
  ".mpeg",
  ".mpg",
  ".ogv",
  ".webm",
  ".3gp",
  ".3g2",

  // Audio extensions.
  ".aac",
  ".midi",
  ".mid",
  ".mp3",
  ".oga",
  ".wav",
  ".3gp",
  ".3g2",

  // Font extensions.
  ".eot",
  ".otf",
  ".ttf",
  ".woff",
  ".woff2",
]);

export default extensions;
