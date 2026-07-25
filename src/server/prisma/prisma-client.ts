/**
 * Instantiates a single instance PrismaClient and save it on the global object.
 * @link https://www.prisma.io/docs/support/help-articles/nextjs-prisma-client-dev-practices
 */
import { PrismaClient } from "@prisma/client";
import { passwordGuardExtension } from "./password-guard";

const prismaGlobal = global as typeof global & {
  prisma?: PrismaClient;
};

/**
 * The client every feature imports, with the password guard applied: a `User` read never carries
 * the hash unless that query explicitly selected it (see `password-guard.ts`).
 *
 * The widening cast is deliberate. `$extends` returns a structurally different client type, and the
 * extension only ever REMOVES a field at runtime — something Prisma's generated types can't express
 * — so casting back keeps the ~10 usecases that take a `PrismaClient` compiling without weakening
 * anything they actually do.
 */
export const prisma: PrismaClient =
  prismaGlobal.prisma ??
  (new PrismaClient({
    /*  log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],*/
  }).$extends(passwordGuardExtension) as unknown as PrismaClient);

if (process.env.NODE_ENV !== "production") {
  prismaGlobal.prisma = prisma;
}
