const path = require('path');
const dir = path.join(__dirname, 'trading-bot');
process.chdir(dir);
require(path.join(dir, 'node_modules', 'vite', 'bin', 'vite.js'));
