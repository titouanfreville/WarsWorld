import type { Role } from "@prisma/client";
import type { DefaultSession } from "next-auth";

/**
 * Session/JWT augmentation. Without this, `session.user.roles` is untyped and a capability check
 * would silently read `undefined` — which is exactly the class of bug that let
 * `token.userRole = "admin"` sit unnoticed with zero consumers.
 */
/* eslint-disable @typescript-eslint/consistent-type-definitions -- module augmentation requires
   `interface`; a `type` alias cannot merge with next-auth's declarations. */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      roles: Role[];
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    roles?: Role[];
  }
}
