const fs=require('fs');const assert=require('assert');
const app=fs.readFileSync('app.js','utf8'),lab=fs.readFileSync('version-lab.html','utf8'),idx=fs.readFileSync('index.html','utf8');
assert(app.includes("const APP_BUILD='2026.09.22.1705'"),'wrong app build');
assert(idx.includes('2026.09.22.1705'),'index build mismatch');
assert(lab.includes("versions/2026.09.21.1310"),'oldest archived build missing');
assert(lab.includes("versions/2026.09.22.1645"),'latest frozen build missing');
assert(lab.includes("ref='develop'"),'?latest must resolve develop');
assert(lab.includes("ref='stable'"),'?stable must resolve stable');
console.log('Snag smoke tests passed');