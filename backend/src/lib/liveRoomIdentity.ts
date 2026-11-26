// Only confirmed historical names belong in this alias. Numeric codes are ambiguous.
const formerRoom = "文强直播间";
const secondRoom = "二号直播间";

export const liveRoomHosts = new Map([
  ["一号直播间", "甜甜"],
  [secondRoom, "文强"],
]);

export function canonicalLiveRoom(room: string): string {
  return room.trim() === formerRoom ? secondRoom : room;
}

// Call only with static column expressions from our queries.
export function liveRoomSql(column: string): string {
  return `(CASE WHEN btrim(${column}) = '${formerRoom}' THEN '${secondRoom}' ELSE ${column} END)`;
}
