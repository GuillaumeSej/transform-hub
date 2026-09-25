import { z } from "zod";

// `companyId` is nullable/optional in the app (null = global admin account) — accept both
// `null` and an omitted field, always normalize to `null` downstream.
const companyIdSchema = z.union([z.string().min(1), z.null()]).optional();

export const renameUserSchema = z.object({
  oldUsername: z.string().trim().min(1),
  newUsername: z.string().trim().min(1),
  companyId: companyIdSchema,
  newPassword: z.string().min(1).optional(),
});

export type RenameUserBody = z.infer<typeof renameUserSchema>;

export const deleteUserSchema = z.object({
  username: z.string().trim().min(1),
  companyId: companyIdSchema,
});

export type DeleteUserBody = z.infer<typeof deleteUserSchema>;

export const setUserDisabledSchema = z.object({
  username: z.string().trim().min(1),
  companyId: companyIdSchema,
  disabled: z.boolean(),
});

export type SetUserDisabledBody = z.infer<typeof setUserDisabledSchema>;

export const passwordResetLinkSchema = z.object({
  username: z.string().trim().min(1),
  companyId: companyIdSchema,
});

export type PasswordResetLinkBody = z.infer<typeof passwordResetLinkSchema>;
