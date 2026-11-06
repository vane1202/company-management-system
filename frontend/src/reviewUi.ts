export type ReviewStatus = "pending" | "approved" | "rejected";

export const reviewStatusLabel: Record<ReviewStatus, string> = {
  pending: "待审",
  approved: "通过",
  rejected: "退回"
};

export type DailyReviewMetrics = {
  revenue: string;
  refunds: string;
  promoCost: string;
  customProductCost: string;
  laborCost: string;
  shippingCost: string;
  orderCount: number;
  promoVideoCount: number;
  shootCount: number;
  finishedCount: number;
  publishedCount: number;
  endingInventory: number;
  fanAddedTotal: number;
};

export function labelReviewStatus(status: string | null | undefined): string {
  if (status === "pending" || status === "approved" || status === "rejected") {
    return reviewStatusLabel[status];
  }
  return "未知";
}

export function parseReviewStatus(value: string | null | undefined): ReviewStatus {
  if (value === "pending" || value === "rejected" || value === "approved") return value;
  return "approved";
}

export function emptyDailyMetrics(): DailyReviewMetrics {
  return {
    revenue: "0.00",
    refunds: "0.00",
    promoCost: "0.00",
    customProductCost: "0.00",
    laborCost: "0.00",
    shippingCost: "0.00",
    orderCount: 0,
    promoVideoCount: 0,
    shootCount: 0,
    finishedCount: 0,
    publishedCount: 0,
    endingInventory: 0,
    fanAddedTotal: 0
  };
}

export function pickDailyByStatus(
  byStatus: Record<ReviewStatus, DailyReviewMetrics> | undefined,
  status: ReviewStatus
): DailyReviewMetrics {
  return byStatus?.[status] ?? emptyDailyMetrics();
}

export function shouldShowStatusNetProfit(): boolean {
  return false;
}
