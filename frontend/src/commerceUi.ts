export const currencies = {CNY:"人民币",TWD:"台币",USD:"美元"};
export const expenseLabels:Record<string,string>={goods:"原石 / 商品供货款",design:"设计雕刻费",labor:"其他加工工费",sourcing:"市场配货采购款",accessory:"配件费",certificate:"证书费",box:"包装费",shipping:"运费",other:"其他支出"};
export const purposeLabels:Record<string,string>={deposit:"定金",balance:"尾款",full:"全款"};
export function cents(value:string):bigint|null {
  if(!/^\d{1,12}(?:\.\d{1,2})?$/.test(value))return null;
  const [whole,fraction=""]=value.split(".");return BigInt(whole)*100n+BigInt(fraction.padEnd(2,"0"));
}
export function money(value:bigint){return `${value/100n}.${String(value%100n).padStart(2,"0")}`;}
/** 原石服务费（即 10% 代购费）按谈成价四舍五入到分；成品为 0。无效价格返回 null。 */
export function defaultBuyingFee(price:string,kind:string){
  const n=cents(price);if(n===null)return null;
  return money(kind==="material"?(n+5n)/10n:0n);
}
export function itemPreview(price:string,kind:string,feeCny?:string){
  const n=cents(price);if(n===null)return null;
  const auto=kind==="material"?(n+5n)/10n:0n;
  const fee=feeCny==null||feeCny===""?auto:cents(feeCny);
  if(fee===null)return null;
  return {fee:money(fee),total:n+fee,autoFee:money(auto)};
}
/** 手动改过的服务费在改谈成价时保留；未改过则按 10% 重算。成品固定为 0。 */
export function buyingFeeAfterPriceChange(kind:string,price:string,current:{feeCny:string;manual:boolean}){
  if(kind!=="material")return {feeCny:"0.00",manual:false};
  if(current.manual)return {feeCny:current.feeCny,manual:true};
  return {feeCny:defaultBuyingFee(price,kind)??current.feeCny,manual:false};
}
export function buyingFeeRestored(price:string,kind:string){
  return {feeCny:defaultBuyingFee(price,kind)??"0.00",manual:false};
}
// The retained key makes transport retries safe; editing the payload starts a new submission.
export function newRequestKey(){
  if(typeof crypto.randomUUID==="function")return crypto.randomUUID();
  // LAN HTTP pages still support getRandomValues, while randomUUID needs HTTPS.
  const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export function submissionKey(){let previous="",key="";return(payload:unknown)=>{const json=JSON.stringify(payload);if(json!==previous){previous=json;key=newRequestKey();}return key;};}
