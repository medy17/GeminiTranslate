const fs = require('fs');
const path = require('path');

// Configuration
const DIST_DIR = path.join(__dirname, 'dist');
const FILES_TO_COPY = [
    'manifest.json',
    'popup.html',
    'popup.js',
    'style.css',
    'content.js',
    'service-worker.js' // Make sure your background script is named this!
];
const FOLDERS_TO_COPY = [
    'icons'
];

// Helpers
function copyFile(filename) {
    const src = path.join(__dirname, filename);
    const dest = path.join(DIST_DIR, filename);

    if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        console.log(`✅ Copied: ${filename}`);
    } else {
        console.warn(`⚠️  Missing file: ${filename}`);
    }
}

function copyFolder(folderName) {
    const src = path.join(__dirname, folderName);
    const dest = path.join(DIST_DIR, folderName);

    if (fs.existsSync(src)) {
        fs.cpSync(src, dest, { recursive: true });
        console.log(`✅ Copied Folder: ${folderName}`);
    } else {
        console.warn(`⚠️  Missing folder: ${folderName}`);
    }
}

// --- Execution ---

console.log('🧹 Cleaning up old dist folder...');
if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
}
fs.mkdirSync(DIST_DIR);

console.log('📦 Building extension...');

// Copy individual files
FILES_TO_COPY.forEach(copyFile);

// Copy directories
FOLDERS_TO_COPY.forEach(copyFolder);

console.log('\n✨ Build complete! Load the "dist" folder in Chrome.');