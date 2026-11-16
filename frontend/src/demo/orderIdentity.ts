import { parseOrderText, type OrderTextFields, type ParsedOrderText } from "./orderTextParser";

// Confirmed room/host names; internal demo keys remain stable to preserve sample links.
export const demoOrderRooms = [
  { code: "DEMO-LIVE-01", name: "海外一线", host: "甜甜" },
  { code: "DEMO-LIVE-02", name: "海外二线", host: "文强" }
] as const;
export function personaDisplay(name = "", code = "") { return code ? `${name}（${code}）` : name; }
export function splitPersona(value: string): { personaName: string; personaCode: string } {
  const match = /^(.+?)[（(]([^()（）]+)[）)]$/.exec(value);
  return match ? { personaName: match[1].trim(), personaCode: match[2].trim() } : { personaName: value, personaCode: "" };
}
export function boundRoom(fields: OrderTextFields) {
  return demoOrderRooms.find(r => (!fields.hostName || fields.hostName === r.host) && (!fields.liveRoomCode || fields.liveRoomCode === r.code) && !!(fields.hostName || fields.liveRoomCode));
}
export function roomDisplay(fields: OrderTextFields) {
  const room = boundRoom(fields);
  return room ? `${room.host} · ${room.name}（${room.code}）` : [fields.hostName, fields.liveRoomCode].filter(Boolean).join(" · ");
}
/** Customer-facing order form convention: 客户 means customer name, IDs remain optional metadata. */
export function parseSimpleOrderText(text: string, today: string, channel: "live" | "private" = "live"): ParsedOrderText {
  const result = parseOrderText(text.replace(/^(\s*)客户\s*[:：]/gm, "$1客户名："), today, { channel });
  result.warnings = result.warnings.filter(w => !/客户ID未提供|人设ID、直播间编号需明确提供|订单编号未提供|主播未明确填写/.test(w));
  const fields = result.fields;
  if (fields.customerLabel && !fields.customerCode) fields.customerCode = "";
  if (result.warnings.some(w => /客户称呼超出/.test(w))) result.errors.push("客户名超出64字，请精简后重新识别，避免与当前客户混淆。");
  if (fields.personaName) {
    const identity = splitPersona(fields.personaName);
    if (identity.personaCode) {
      if (fields.personaCode && identity.personaCode !== fields.personaCode) result.errors.push("人设姓名括号内的ID与单独填写的人设ID不一致，请核对。");
      else Object.assign(fields, identity);
    } else if (!fields.personaCode) fields.personaCode = "";
  }
  if (!fields.customerLabel && fields.customerCode) {
    if (fields.customerCode.length <= 64) fields.customerLabel = fields.customerCode;
    result.warnings.push("汇报只提供客户ID，请核对客户名；未按同名自动关联历史订单。");
  }
  delete result.fieldHints.customerLabel;
  if (channel === "private") {
    if (!fields.customerLabel) result.warnings.push("客户名未提供，请补填。");
    return result;
  }
  if (!fields.hostName && !fields.liveRoomCode && fields.source) {
    const sourceRoom = demoOrderRooms.find(r => [r.name, r.host, r.code, `${r.host}直播间`].includes(fields.source!));
    if (sourceRoom) { fields.hostName = sourceRoom.host; fields.liveRoomCode = sourceRoom.code; }
  }
  const room = boundRoom(fields);
  if (room) { fields.hostName = room.host; fields.liveRoomCode = room.code; }
  else if (fields.hostName && fields.liveRoomCode && demoOrderRooms.some(r => r.host === fields.hostName || r.code === fields.liveRoomCode)) result.errors.push("主播与直播间编号不符合已登记的绑定关系，请核对后重新识别。");
  else result.warnings.push("请在「主播 / 直播间」中选择已绑定的直播间；不根据人设推断直播间。");
  if (!fields.customerLabel) result.warnings.push("客户名未提供，请补填。");
  if (fields.source && room && ![room.code, room.name, room.host, `${room.host}直播间`].includes(fields.source)) result.warnings.push(`原文来源「${fields.source}」与已选直播间不同，原文保留，请核对；页面不再单独填来源。`);
  return result;
}
