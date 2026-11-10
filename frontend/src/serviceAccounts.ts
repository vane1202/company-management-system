export type ServicePlatform='whatsapp'|'messenger'|'legacy_wechat';
export const platformLabels:Record<ServicePlatform,string>={whatsapp:'WhatsApp',messenger:'Messenger',legacy_wechat:'历史微信（待核对）'};
export function isServiceAccount(kind?:string){return kind==='cs_service'||kind==='cs_wechat';}
