// Japanese translations, split by area. Keys are the exact English source strings.
import { JA_CONTRIB } from "./ja-contrib.js";
import { JA_FIXES } from "./ja-fixes.js";
import { JA_PAGES } from "./ja-pages.js";
import { JA_SERVER, JA_SERVER_PATTERNS } from "./ja-server.js";
import { JA_SHARED } from "./ja-shared.js";

export const JA = { ...JA_SERVER, ...JA_SHARED, ...JA_PAGES, ...JA_CONTRIB, ...JA_FIXES };
/** [RegExp, replacement] for server messages that contain values. First match wins. */
export const JA_PATTERNS = [...JA_SERVER_PATTERNS];
