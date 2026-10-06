// Copies the browser builds of three.js and @solana/web3.js into public/vendor so any static host can serve them.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'public', 'vendor');
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(root, 'node_modules/three/build/three.min.js'), path.join(out, 'three.min.js'));
fs.copyFileSync(path.join(root, 'node_modules/@solana/web3.js/lib/index.iife.min.js'), path.join(out, 'web3.min.js'));
console.log('Copied browser libraries to public/vendor');
