// Backwards-compatible entry point for pre-monorepo (3.x and earlier)
// deployments that ran `node app.js` from the repository root. Loads this
// directory's .env — the legacy location — and, if a legacy ./data directory
// is still here, points DATA_FILE_PATH/STATS_FILE_PATH at it so existing
// subscriptions and stats keep working untouched. Then hands off to the real
// server in apps/server, which every other entry point (`pnpm start`,
// Docker, etc.) already uses.
'use strict';

const fs = require('fs');
const path = require('path');

// No npm dependency at the repo root under pnpm's isolated node_modules layout,
// so use Node's built-in loader (throws if the file is missing) rather than
// pulling in apps/server's `dotenv`.
const rootEnvPath = path.join(__dirname, '.env');
if (fs.existsSync(rootEnvPath)) {
    process.loadEnvFile(rootEnvPath);
}

const legacyDataDir = path.join(__dirname, 'data');
if (fs.existsSync(legacyDataDir)) {
    process.env.DATA_FILE_PATH ??= path.join(
        legacyDataDir,
        'subscriptions.json'
    );
    process.env.STATS_FILE_PATH ??= path.join(legacyDataDir, 'stats.json');
}

// apps/server assumes its own directory is the cwd (relative dotenv/static/
// data-file paths), so match that before requiring it.
process.chdir(path.join(__dirname, 'apps', 'server'));

require('./apps/server/app.js');
