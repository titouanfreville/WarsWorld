import { z } from "zod";

/**
 * The ranked escape hatch, deliberately **config-only**.
 *
 * Dev tools are refused in ranked matches. That refusal is overridable by configuration and never by
 * a role — no amount of privilege lets a caller flip it per-request, so production can hold the line
 * while a local or dev environment turns it on for hard testing.
 *
 * Parsed once at module load: env is fixed for the process lifetime, and re-reading per request
 * would let a mutation of `process.env` change the answer mid-flight.
 */
const envSchema = z.object({
  /** Only ever "true" in local/dev or a deliberate testing deployment. */
  DEV_TOOLS_ALLOW_RANKED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(
    `Invalid dev-tools config: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join(", ")}`,
  );
}

export const devToolsConfig = {
  allowInRankedMatches: parsed.data.DEV_TOOLS_ALLOW_RANKED,
} as const;
