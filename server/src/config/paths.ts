import { fileURLToPath } from 'node:url';

// Resolved from this module's own location, not process.cwd(). This file sits two levels below
// the server root both as source (src/config/paths.ts) and compiled (dist/config/paths.js).
export const serverRoot = fileURLToPath(new URL('../../', import.meta.url));
