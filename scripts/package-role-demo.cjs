const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const bossP0=process.argv.includes('--boss-p0');
const directoryArgument=process.argv.indexOf('--service-directory');
const registeredDirectory=directoryArgument<0?null:require('./demo-service-directory.cjs').buildServiceDirectory(JSON.parse(fs.readFileSync(path.resolve(root,process.argv[directoryArgument+1]),'utf8')));
const source=path.join(root,bossP0?'frontend/dist-demo':'frontend/dist');
if(bossP0&&!fs.existsSync(path.join(source,'index.html')))throw Error('先使用 --mode demo --outDir dist-demo 构建独立演示');
const destination=path.join(root,'artifacts','role-demo-site');
fs.mkdirSync(destination,{recursive:true});
// Clear only files recorded by our previous generated build; never recurse-delete.
const priorManifest=path.join(root,'artifacts','role-demo-manifest.json');
if(fs.existsSync(priorManifest))for(const entry of JSON.parse(fs.readFileSync(priorManifest,'utf8'))){const target=path.resolve(destination,entry.file);if(!target.startsWith(destination+path.sep))throw Error('Unexpected artifact path');if(fs.existsSync(target)&&fs.statSync(target).isFile())fs.unlinkSync(target);}
function copy(from,to){fs.mkdirSync(to,{recursive:true});for(const entry of fs.readdirSync(from,{withFileTypes:true})){const input=path.join(from,entry.name),output=path.join(to,entry.name);if(entry.isDirectory())copy(input,output);else if(/\.(html|css|js|svg|png|ico)$/.test(entry.name))fs.writeFileSync(output,fs.readFileSync(input));}}
copy(source,destination);
fs.writeFileSync(path.join(destination,'reimbursements.js'),fs.readFileSync(path.join(root,'demo/reimbursements.js')));
fs.writeFileSync(path.join(destination,'warehouse-settlements.js'),fs.readFileSync(path.join(root,'demo/warehouse-settlements.js')));
fs.writeFileSync(path.join(destination,'demo-preview.js'),fs.readFileSync(path.join(root,'demo/readonly-api.js')));
if(bossP0)fs.writeFileSync(path.join(destination,'boss-overview-metrics.js'),fs.readFileSync(path.join(root,'demo/boss-overview-metrics.js')));
if(bossP0)fs.writeFileSync(path.join(destination,'ops-analysis-metrics.js'),fs.readFileSync(path.join(root,'demo/ops-analysis-metrics.js')));
fs.writeFileSync(path.join(destination,'live-room-operations.js'),fs.readFileSync(path.join(root,'demo/live-room-operations.js')));
fs.writeFileSync(path.join(destination,'assessment-foundation.js'),fs.readFileSync(path.join(root,'demo/assessment-foundation.js')));
fs.writeFileSync(path.join(destination,'boss-priority.js'),fs.readFileSync(path.join(root,'demo/boss-priority.js')));
fs.writeFileSync(path.join(destination,'editor-history.js'),fs.readFileSync(path.join(root,'demo/editor-history.js')));
fs.writeFileSync(path.join(destination,'supervisor-consultation-cost.js'),fs.readFileSync(path.join(root,'demo/supervisor-consultation-cost.js')));
const supervisorAdLinks=JSON.parse(fs.readFileSync(path.join(root,'demo/supervisor-ad-links.json'),'utf8').replace(/^\uFEFF/,''));
if(!Array.isArray(supervisorAdLinks)||supervisorAdLinks.some(link=>!link||typeof link.teamId!=='string'||!link.teamId.trim()||typeof link.account!=='string'||!link.account.trim()||!/^\d{4}-\d{2}-\d{2}$/.test(link.from||'')||link.to&&(!/^\d{4}-\d{2}-\d{2}$/.test(link.to)||link.to<link.from)))throw Error('主管广告户关联格式无效');
fs.writeFileSync(path.join(destination,'supervisor-ad-links.js'),'window.CmsSupervisorAdLinks='+JSON.stringify(supervisorAdLinks).replaceAll('<','\\u003c')+';\n');
fs.writeFileSync(path.join(destination,'ops-workspace.js'),fs.readFileSync(path.join(root,'demo/ops-workspace.js')));
fs.writeFileSync(path.join(destination,'service-account-management.js'),fs.readFileSync(path.join(root,'demo/service-account-management.js')));
if(registeredDirectory)fs.writeFileSync(path.join(destination,'service-directory.js'),'window.CmsServiceDirectory='+JSON.stringify(registeredDirectory).replaceAll('<','\\u003c')+';\n');
let html=fs.readFileSync(path.join(destination,'index.html'),'utf8');
html=html.replace('<head>','<head>\n    <meta name="robots" content="noindex,nofollow,noarchive" />\n    '+(bossP0?'<script src="/boss-overview-metrics.js"></script>\n    <script src="/ops-analysis-metrics.js"></script>\n    ':'')+'<script src="/assessment-foundation.js"></script>\n    <script src="/live-room-operations.js"></script>\n    <script src="/reimbursements.js"></script><script src="/warehouse-settlements.js"></script><script src="/demo-preview.js"></script>');
html=html.replace('<script src="/reimbursements.js"></script><script src="/warehouse-settlements.js"></script><script src="/demo-preview.js"></script>','<script src="/boss-priority.js"></script>\n    <script src="/editor-history.js"></script>\n    <script src="/supervisor-ad-links.js"></script>\n    <script src="/supervisor-consultation-cost.js"></script>\n    <script src="/ops-workspace.js"></script>\n    <script src="/service-account-management.js"></script>\n    <script src="/reimbursements.js"></script><script src="/warehouse-settlements.js"></script><script src="/demo-preview.js"></script>');
html=html.replace('<title>公司内部管理系统</title>','<title>翠管家 · 多端只读演示</title>');
if(registeredDirectory)html=html.replace('<script src="/reimbursements.js"></script><script src="/warehouse-settlements.js"></script><script src="/demo-preview.js"></script>','<script src="/service-directory.js"></script>\n    <script src="/reimbursements.js"></script><script src="/warehouse-settlements.js"></script><script src="/demo-preview.js"></script>');
html=html.replace('<body>',`<body><aside class="demo-preview-banner" aria-label="演示环境"><strong>公开只读演示 · 业务数据虚构</strong><span class="demo-switch-label">切换查看：</span><button type="button" data-demo-role="admin">后台管理员</button><button type="button" data-demo-role="boss">BOSS</button><button type="button" data-demo-role="cs_supervisor">客服主管</button><button type="button" data-demo-role="finance">财务</button><button type="button" data-demo-role="warehouse">库房</button><button type="button" data-demo-role="cs">客服填报</button><button type="button" data-demo-role="editor">拍剪填报</button><button type="button" data-demo-role="ops">运营端</button><select class="demo-mobile-role" aria-label="切换演示角色"><option value="admin">后台管理员</option><option value="boss">BOSS</option><option value="cs_supervisor">客服主管</option><option value="finance">财务</option><option value="warehouse">库房</option><option value="cs">客服填报</option><option value="editor">拍剪填报</option><option value="ops">运营端</option></select><small>不连接正式后台，修改不保存</small></aside>`);
html=html.replace('</head>',`<style>.demo-preview-banner{position:sticky;top:0;z-index:100;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:9px 20px;background:#fff;color:#33413c;border-bottom:1px solid #e2e7e4;font:13px/1.4 "PingFang SC","Microsoft YaHei",sans-serif}.demo-preview-banner strong{display:inline-flex;align-items:center;gap:8px;margin-right:6px;font-weight:600}.demo-preview-banner strong::before{content:"";width:8px;height:8px;border-radius:50%;background:#c58a2d}.demo-switch-label{color:#6b7873}.demo-preview-banner button{border:1px solid #d5ddd9;background:#fff;color:#33413c;padding:5px 13px;border-radius:999px;font-size:13px;touch-action:manipulation;cursor:pointer}.demo-preview-banner button[aria-current=true]{background:#0e2c27;border-color:#0e2c27;color:#fff}.demo-preview-banner small{margin-left:auto;color:#6b7873;font-size:12px}.demo-mobile-role{display:none}@media(max-width:799px){.demo-preview-banner{gap:0 8px;padding:4px 12px 6px}.demo-preview-banner strong{font-size:12px;flex:1;white-space:nowrap}.demo-preview-banner button,.demo-switch-label{display:none}.demo-preview-banner small{width:100%;margin:0;font-size:11px;line-height:14px}.demo-mobile-role{display:block;width:120px;min-height:40px;padding:4px 28px 4px 10px;border:1px solid #d5ddd9;border-radius:999px;background-color:#fff;color:#33413c;font-size:13px}}</style></head>`);
fs.writeFileSync(path.join(destination,'index.html'),html);
if(registeredDirectory)fs.writeFileSync(path.join(destination,'index.html'),html.replace('不连接正式后台，修改不保存','含已登记人员及账号 · 业务虚构，修改不保存'));
fs.writeFileSync(path.join(destination,'_headers'),'/*\n  X-Robots-Tag: noindex, nofollow, noarchive\n  X-Content-Type-Options: nosniff\n');
// SPA routing is configured on the static host; do not add overlapping rewrites.
const legacyRedirect=path.join(destination,'_redirects');
if(fs.existsSync(legacyRedirect))fs.unlinkSync(legacyRedirect);
// Only explicit frontend files and the optionally supplied directory enter this package.
const manifest=[];
function scan(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())scan(file);else manifest.push({file:path.relative(destination,file).replaceAll('\\','/'),bytes:fs.statSync(file).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')});}}
scan(destination);
fs.writeFileSync(path.join(root,'artifacts','role-demo-manifest.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({destination,files:manifest.length,bytes:manifest.reduce((total,file)=>total+file.bytes,0)}));
