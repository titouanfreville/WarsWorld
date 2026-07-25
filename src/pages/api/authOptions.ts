/* 
  NOTE: If you try to register or first login with two providers that have the same email, the second provider will fail.
  The first provider will register the first email and so the second cannot be registered.
*/
import { compare } from "bcrypt";
import type { NextAuthOptions } from "next-auth";
import type { Adapter } from "next-auth/adapters";
import type { Provider } from "next-auth/providers";
import CredentialsProvider from "next-auth/providers/credentials";
import type { DiscordProfile } from "next-auth/providers/discord";
import DiscordProvider from "next-auth/providers/discord";
import GithubProvider from "next-auth/providers/github";
import GoogleProvider from "next-auth/providers/google";
import { prisma } from "server/prisma/prisma-client";
import { loginSchema } from "server/auth/schemas";
import { clientIp } from "server/auth/client-ip";
import { signInThrottle } from "server/auth/throttle.dbo";
import { RateLimiter } from "server/auth/throttle";
import { z } from "zod";
import WarsWorldAdapter from "./WarsWorldAdapter";

const adapter = WarsWorldAdapter(prisma) as Adapter;

/**
 * Burst guard on sign-in: more than 3 attempts per IP per minute fails, whatever credentials they
 * carry. Someone who knows their password needs one; someone who mistyped needs two or three.
 *
 * This caps the DB backoff's grace allowance in practice — reaching 6 recorded failures now takes a
 * couple of minutes rather than seconds. That's the point: the two layers answer different
 * questions, this one "how fast", the other "how many, ever".
 */
const signInLimiter = new RateLimiter(3, 60_000);

const envCredential = z.string().trim().min(1);

const githubEnvSchema = z.object({
  GITHUB_CLIENT_ID: envCredential,
  GITHUB_CLIENT_SECRET: envCredential,
});

const googleEnvSchema = z.object({
  GOOGLE_CLIENT_ID: envCredential,
  GOOGLE_CLIENT_SECRET: envCredential,
});

const discordEnvSchema = z.object({
  DISCORD_CLIENT_ID: envCredential,
  DISCORD_CLIENT_SECRET: envCredential,
});

const githubEnvParsed = githubEnvSchema.safeParse(process.env);
const googleEnvParsed = googleEnvSchema.safeParse(process.env);
const discordEnvParsed = discordEnvSchema.safeParse(process.env);

const providers: Provider[] = [
  CredentialsProvider({
    credentials: {
      // TODO: Change name to a unique identifier, maybe for email or both idk.
      name: {
        label: "Username",
        type: "username",
        placeholder: "Username",
      },
      password: {
        label: "Password",
        type: "password",
        placeholder: "Password",
      },
    },
    async authorize(credentials, req) {
      if (!credentials) {
        return null;
      }

      const loginParse = loginSchema.safeParse(credentials);

      if (!loginParse.success) {
        return null;
      }

      const { name, password } = loginParse.data;
      const now = new Date();

      // First line: cap how fast one caller can hit sign-in at all. Cheap, in-memory, and applies
      // even to correct credentials, which the per-account backoff below deliberately doesn't.
      const ip = clientIp(req);

      signInLimiter.prune(now.getTime());

      if (!signInLimiter.take(ip, now.getTime())) {
        throw new Error("Too many sign-in attempts. Please wait a minute and try again.");
      }

      // Second line: the per-account backoff, which survives restarts and IP rotation.
      const lockedFor = await signInThrottle.remainingLock(name, now);

      if (lockedFor !== null) {
        throw new Error(`Too many failed attempts. Try again in ${lockedFor} seconds.`);
      }

      // The ONE query in the codebase allowed to see the password hash, and the only reason the
      // guard in `prisma/password-guard.ts` has an opt-in at all: without this explicit `select`
      // the hash comes back `undefined` and every login is rejected. Selecting field-by-field also
      // keeps the rest of the row (roles, state, timestamps) out of a request that doesn't need it.
      // `findUnique` is now possible — and correct — because `User.name` is unique.
      const dbUser = await prisma.user.findUnique({
        where: { name },
        select: { id: true, name: true, email: true, password: true },
      });

      // An unknown account and a wrong password are recorded and answered identically: any
      // difference here is a user-enumeration oracle, which is exactly what we just removed from
      // `findFirstUserByName`.
      if (dbUser?.password == undefined) {
        await signInThrottle.recordFailure(name, now);

        return null;
      }

      const doPasswordsMatch = await compare(password, dbUser.password);

      if (!doPasswordsMatch) {
        await signInThrottle.recordFailure(name, now);

        return null;
      }

      // Signing in successfully clears the record, so an honest user who fumbled a few times never
      // carries a lock into their next session.
      await signInThrottle.clear(name);

      return {
        id: dbUser.id,
        name: dbUser.name,
        email: dbUser.email,
      };
    },
  }),
];

if (githubEnvParsed.success) {
  providers.push(
    GithubProvider({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    }),
  );
}

if (googleEnvParsed.success) {
  providers.push(
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  );
}

if (discordEnvParsed.success) {
  providers.push(
    DiscordProvider({
      clientId: process.env.DISCORD_CLIENT_ID!,
      clientSecret: process.env.DISCORD_CLIENT_SECRET!,
      profile(profile: DiscordProfile) {
        /* 
          For some reason Discord provider doesn't send the user's data properly.
          It probably expects another type of squema.
          That's why I manually made the object here.
          This object is going to be fed into prisma.user.create() behind the scenes.
        */
        return {
          id: profile.id,
          name: profile.username,
          email: profile.email,
          emailVerified: null,
        };
      },
    }),
  );
}

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  adapter: adapter,
  debug: process.env.NODE_ENV == "development",
  providers,
  pages: {
    signIn: "/?authModalOpen",
  },
  session: {
    strategy: "jwt",
  },
  callbacks: {
    redirect({ url, baseUrl }) {
      if (url.startsWith("/")) {
        return `${baseUrl}${url}`;
      } else if (new URL(url).origin === baseUrl) {
        return url;
      }

      return baseUrl; // redirect callback
    },
    async jwt({ token, user, trigger }) {
      if (user != undefined) {
        token.id = user.id;
      }

      /**
       * Roles come from the DB and nowhere else.
       *
       * Re-read on sign-in and on an explicit session update rather than only when `user` is set:
       * JWTs here are long-lived, so a role revoked in the DB must not stay live in an old token
       * for the rest of its lifetime. This is the narrowest refresh that still bounds that window.
       */
      if (user != undefined || trigger === "update") {
        const dbUser =
          typeof token.id === "string"
            ? await prisma.user.findUnique({
                where: { id: token.id },
                select: { roles: true },
              })
            : null;

        token.roles = dbUser?.roles ?? [];
      }

      return token;
    },
    session({ session, token }) {
      /** Mirror onto the session so `ctx.session.user.roles` is the one source for capability checks. */
      session.user.id = typeof token.id === "string" ? token.id : "";
      session.user.roles = Array.isArray(token.roles) ? token.roles : [];
      return session;
    },
  },
};

export default authOptions;
