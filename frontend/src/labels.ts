export const orderStatusLabel: Record<string, string> = {
  placed: "下单",
  in_production: "制作中",
  shipped: "已发货",
  refunded: "退款"
};

export function labelOrderStatus(status: string): string {
  return orderStatusLabel[status] ?? status;
}
