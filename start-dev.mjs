import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
process.chdir(join(__dirname, 'trading-bot'));
await import('file:///' + join(__dirname, 'trading-bot', 'node_modules', 'vite', 'bin', 'vite.js').replace(/\\/g, '/'));
