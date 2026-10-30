import { and, eq } from "drizzle-orm";
import { verifyPassword } from "better-auth/crypto";
import { authAccounts, type Db } from "@paperclipai/db";

/** Kiểm mật khẩu đăng nhập (tài khoản `credential` của Better Auth); user không có mật khẩu thì `false`. */
export async function verifyUserPassword(db: Db, userId: string, password: string): Promise<boolean> {
  const [account] = await db
    .select({ hash: authAccounts.password })
    .from(authAccounts)
    .where(and(eq(authAccounts.userId, userId), eq(authAccounts.providerId, "credential")))
    .limit(1);
  if (!account?.hash) return false;
  return verifyPassword({ hash: account.hash, password });
}
