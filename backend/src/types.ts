import "express-session";

declare module "express-session" {
  interface SessionData {
    userId?: string;
    csrfToken?: string;
    deviceVersion?: number;
  }
}

export type UserRole =
  | "boss"
  | "admin"
  | "finance"
  | "assistant"
  | "ops"
  | "editor"
  | "cs"
  | "cs_supervisor";

export type OrderStatus = "placed" | "in_production" | "shipped" | "refunded";

export type PublicUser = {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  mustChangePassword: boolean;
  accountKind?: "employee" | "cs_wechat" | "cs_service";
  servicePlatform?: 'whatsapp'|'messenger'|'legacy_wechat'|null;
  accountIdentifier?:string|null;
  serviceAccountLabel?:string|null;
  wechatId?: string | null;
  phoneLabel?: string | null;
  deviceVersion?: number;
};

export class HttpError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}


declare global {
  namespace Express {
    interface Request {
      actor?: PublicUser;
    }
  }
}
