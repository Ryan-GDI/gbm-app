// Build script: replaces config placeholders with real environment variables
// Run by Vercel at build time
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'src', 'config.js');
let config = fs.readFileSync(configPath, 'utf8');

const url = process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_ANON_KEY || '';

if (!url || !key) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_ANON_KEY must be set in Vercel environment variables.');
  process.exit(1);
}

config = config.replace('__SUPABASE_URL__', url).replace('__SUPABASE_ANON_KEY__', key);
fs.writeFileSync(configPath, config);

console.log('✓ Config injected with Supabase credentials');
