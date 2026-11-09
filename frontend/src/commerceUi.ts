export const currencies = {CNY:"人民币",TWD:"台币",USD:"美元"};
export const expenseLabels:Record<string,string>={goods:"商品 / 料子成本",labor:"工费",certificate:"证书",box:"包装盒",shipping:"运费",other:"其他支出"};
export const purposeLabels:Record<string,string>={deposit:"定金",balance:"尾款",full:"全款"};
export function cents(value:string):bigint|null {
  if(!/^\d{1,12}(?:\.\d{1,2})?$/.test(value))return null;
  const [whole,fraction=""]=value.split(".");return BigInt(whole)*100n+BigInt(fraction.padEnd(2,"0"));
}
export function money(value:bigint){return `${value/100n}.${String(value%100n).padStart(2,"0")}`;}
export function itemPreview(price:string,kind:string){const n=cents(price);return n===null?null:{fee:money(kind==="material"?(n+5n)/10n:0n),total:n+(kind==="material"?(n+5n)/10n:0n)};}
// The retained key makes transport retries safe; editing the payload starts a new submission.
export function newRequestKey(){
  if(typeof crypto.randomUUID==="function")return crypto.randomUUID();
  // LAN HTTP pages still support getRandomValues, while randomUUID needs HTTPS.
  const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export function submissionKey(){let previous="",key="";return(payload:unknown)=>{const json=JSON.stringify(payload);if(json!==previous){previous=json;key=newRequestKey();}return key;};}
