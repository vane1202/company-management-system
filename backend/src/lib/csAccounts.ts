import { createHash, randomBytes } from "node:crypto";
import { HttpError } from "../types.js";

export function normalizeRegistrationCode(value: unknown): string {
  const code = String(value ?? "").replace(/[\s-]/g, "").toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(code)) throw new HttpError(400, "登记码无效，请向管理员获取一次性登记码");
  return code;
}
export function registrationHash(code: string): string { return createHash("sha256").update(code).digest("hex"); }
export function newRegistrationCode(): string { return randomBytes(16).toString("hex"); }
export function parseWechatId(value: unknown): string {
  const id = String(value ?? "").trim();
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{5,63}$/.test(id)) throw new HttpError(400, "请填写微信号（6–64 位字母、数字、下划线或短横线，字母开头），不要填写昵称");
  return id;
}
export function parseAccountId(value: unknown): string {
  const id = String(value ?? "");
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) throw new HttpError(400, "账号标识无效");
  return id;
}
export type ServicePlatform='whatsapp'|'messenger'|'legacy_wechat';
export function isDeviceAccount(kind:unknown):boolean{return kind==='cs_service'||kind==='cs_wechat';}
export function parseServiceIdentity(platform:unknown,value:unknown):{platform:'whatsapp'|'messenger';identifier:string}{
 if(platform!=='whatsapp'&&platform!=='messenger')throw new HttpError(400,'请选择 WhatsApp 或 Messenger');
 let id=String(value??'').trim();
 if(platform==='whatsapp'){
  if(/^https?:\/\//i.test(id)){let u:URL;try{u=new URL(id);}catch{throw new HttpError(400,'WhatsApp号码或链接无效');}if(!['wa.me','www.wa.me'].includes(u.hostname.toLowerCase())||u.search||u.hash||u.username||u.password)throw new HttpError(400,'请填写国际号码或 wa.me/号码');id='+'+u.pathname.replace(/^\//,'');}
  id=id.replace(/[\s()\-]/g,'');if(!/^\+[1-9]\d{6,14}$/.test(id))throw new HttpError(400,'WhatsApp请填写含国家/地区码的国际号码，例如 +60123456789');
 }else{
  if(/^https?:\/\//i.test(id)){let u:URL;try{u=new URL(id);}catch{throw new HttpError(400,'Messenger链接无效');}if(!['m.me','www.m.me'].includes(u.hostname.toLowerCase())||u.search||u.hash||u.username||u.password)throw new HttpError(400,'请填写 Messenger主页ID、用户名或 m.me 链接');try{id=decodeURIComponent(u.pathname.replace(/^\//,'').replace(/\/$/,''));}catch{throw new HttpError(400,'Messenger链接无效');}}
  if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,127}$/.test(id))throw new HttpError(400,'Messenger请填3–128位主页ID或用户名，不要填写显示昵称');id=id.toLowerCase();
 }
 return {platform,identifier:id};
}
export function serviceLabel(platform:string,id:string){return platform==='whatsapp'?`WhatsApp · ${id}`:platform==='messenger'?`Messenger · ${id}`:id;}
export function assertServiceChannel(platform:unknown,channel:string){if(platform==='whatsapp'&&channel!=='ws'||platform==='messenger'&&channel!=='ms')throw new HttpError(400,'客户线索渠道必须与当前接待账号的平台一致');}
