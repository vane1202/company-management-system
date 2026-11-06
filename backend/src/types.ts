import "express-session";

declare module "express-session" {
  interface SessionData {
    userId?: string;
    csrfToken?: string;
  }
}

export type UserRole =
  | "boss"
  | "admin"
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
