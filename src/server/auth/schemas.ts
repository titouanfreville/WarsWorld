import { z } from "zod";

// Auth input validation (server-authoritative). The frontend has its own form schema for UX;
// the server always re-validates here. Moved out of src/shared.

/**
 * Strength policy for a password being SET (sign-up, and any future password change).
 *
 * The 40-character ceiling stays: bcrypt ignores anything past 72 bytes, so raising it buys nothing.
 */
export const passwordSchema = z
  .string()
  .min(8, "Password needs to be at least 8 characters long.")
  .max(40, "Password exceeds 40 characters.");

/**
 * Sign-in deliberately does NOT apply the strength policy — it only checks that something was typed.
 *
 * Reusing `passwordSchema` here would mean every tightening of the rules silently locks out the
 * accounts created under the old one: their password is still correct, but the request is rejected
 * before it is ever compared. How strong a password must be is a question for the moment it is
 * chosen; at sign-in the only question is whether it matches.
 */
export const loginSchema = z.object({
  name: z.string().min(1, "Name is empty."),
  password: z.string().min(1, "Password is empty."),
});

export const signUpSchema = z.object({
  name: z.string().min(1, "Name is empty."),
  password: passwordSchema,
  email: z.string().min(1, "Email is empty.").email("Invalid email."),
});

export type Login = z.infer<typeof loginSchema>;
export type SignUp = z.infer<typeof signUpSchema>;
