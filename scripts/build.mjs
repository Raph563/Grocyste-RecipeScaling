import{readFile,writeFile,mkdir}from'node:fs/promises';import{Script}from'node:vm';
const c=JSON.parse(await readFile('build-config.json','utf8'));
const code=(await Promise.all(c.files.map(p=>readFile(p,'utf8')))).map(s=>s.replace(/^import[\s\S]*?;\r?\n/gm,'').replace(/^export /gm,'')).join('\n');
const profiles=c.id==='equivalents'?'if(configureProfiles?.length)configureFamilyProfiles(configureProfiles);\n':'';
const output=`(()=>{'use strict';if(!globalThis.Grocyste?.available())return;\n${c.prefix}\n${code}\n${profiles}${c.suffix}\n})();\n`;
new Script(output);await mkdir('dist',{recursive:true});await writeFile('dist/addon.js',output);
await writeFile('dist/addon.css',(await Promise.all(c.styles.map(p=>readFile(p,'utf8')))).join('\n'));
