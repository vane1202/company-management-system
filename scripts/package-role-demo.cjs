const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const bossP0=process.argv.includes('--boss-p0');
const source=path.join(root,bossP0?'frontend/dist-demo':'frontend/dist');
if(bossP0&&!fs.existsSync(path.join(source,'index.html')))throw Error('先使用 --mode demo --outDir dist-demo 构建独立演示');
const destination=path.join(root,'artifacts','role-demo-site');
fs.mkdirSync(destination,{recursive:true});
// Clear only files recorded by our previous generated build; never recurse-delete.
const priorManifest=path.join(root,'artifacts','role-demo-manifest.json');
if(fs.existsSync(priorManifest))for(const entry of JSON.parse(fs.readFileSync(priorManifest,'utf8'))){const target=path.resolve(destination,entry.file);if(!target.startsWith(destination+path.sep))throw Error('Unexpected artifact path');if(fs.existsSync(target)&&fs.statSync(target).isFile())fs.unlinkSync(target);}
function copy(from,to){fs.mkdirSync(to,{recursive:true});for(const entry of fs.readdirSync(from,{withFileTypes:true})){const input=path.join(from,entry.name),output=path.join(to,entry.name);if(entry.isDirectory())copy(input,output);else if(/\.(html|css|js|svg|png|ico)$/.test(entry.name))fs.writeFileSync(output,fs.readFileSync(input));}}
copy(source,destination);
fs.writeFileSync(path.join(destination,'demo-preview.js'),fs.readFileSync(path.join(root,'demo/readonly-api.js')));
if(bossP0)fs.writeFileSync(path.join(destination,'boss-overview-metrics.js'),fs.readFileSync(path.join(root,'demo/boss-overview-metrics.js')));
if(bossP0)fs.writeFileSync(path.join(destination,'ops-analysis-metrics.js'),fs.readFileSync(path.join(root,'demo/ops-analysis-metrics.js')));
let html=fs.readFileSync(path.join(destination,'index.html'),'utf8');
html=html.replace('<head>','<head>\n    <meta name="robots" content="noindex,nofollow,noarchive" />\n    '+(bossP0?'<script src="/boss-overview-metrics.js"></script>\n    <script src="/ops-analysis-metrics.js"></script>\n    ':'')+'<script src="/demo-preview.js"></script>');
html=html.replace('<title>公司内部管理系统</title>','<title>翠管家 · 多端只读演示</title>');
html=html.replace('<body>',`<body><aside class="demo-preview-banner" aria-label="演示环境"><strong>公开只读演示 · 全部数据虚构</strong><span class="demo-switch-label">切换查看：</span><button type="button" data-demo-role="admin">后台管理员</button><button type="button" data-demo-role="boss">BOSS</button><button type="button" data-demo-role="cs_supervisor">客服主管</button><button type="button" data-demo-role="finance">财务</button><select class="demo-mobile-role" aria-label="切换演示角色"><option value="admin">后台管理员</option><option value="boss">BOSS</option><option value="cs_supervisor">客服主管</option><option value="finance">财务</option></select><small>不连接正式后台，修改不保存</small></aside>`);
html=html.replace('</head>',`<style>.demo-preview-banner{position:sticky;top:0;z-index:100;display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 20px;background:#fff3d8;color:#624712;border-bottom:1px solid #e4d1a6;font:14px/1.4 "Microsoft YaHei",sans-serif}.demo-preview-banner button{border:1px solid #d8c49a;background:#fffaf0;color:#624712;padding:8px 12px;border-radius:7px;touch-action:manipulation;cursor:pointer}.demo-preview-banner button[aria-current=true]{background:#624712;color:#fff}.demo-preview-banner small{margin-left:auto}.demo-mobile-role{display:none}@media(max-width:799px){.demo-preview-banner{gap:0 8px;padding:3px 12px 5px}.demo-preview-banner strong{font-size:11px;flex:1;white-space:nowrap}.demo-preview-banner button,.demo-switch-label{display:none}.demo-preview-banner small{width:100%;margin:0;font-size:10px;line-height:14px}.demo-mobile-role{display:block;width:110px;min-height:44px;padding:6px;border:0;border-radius:6px;background:transparent;color:#624712;font-size:12px}}</style></head>`);
fs.writeFileSync(path.join(destination,'index.html'),html);
fs.writeFileSync(path.join(destination,'_headers'),'/*\n  X-Robots-Tag: noindex, nofollow, noarchive\n  X-Content-Type-Options: nosniff\n');
// SPA routing is configured on the static host; do not add overlapping rewrites.
const legacyRedirect=path.join(destination,'_redirects');
if(fs.existsSync(legacyRedirect))fs.unlinkSync(legacyRedirect);
// Only explicit, compiled public frontend files and fictional data enter this package.
const manifest=[];
function scan(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())scan(file);else manifest.push({file:path.relative(destination,file).replaceAll('\\','/'),bytes:fs.statSync(file).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')});}}
scan(destination);
fs.writeFileSync(path.join(root,'artifacts','role-demo-manifest.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({destination,files:manifest.length,bytes:manifest.reduce((total,file)=>total+file.bytes,0)}));
