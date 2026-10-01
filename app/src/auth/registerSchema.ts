import { z } from 'zod';
import { strings } from '../strings';
import { emailSchema } from './loginSchema';

// Mirrors Better Auth's default password length limits (8–128).
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const registerSchema = z
  .object({
    name: z.string().trim().min(1, strings.validation.nameRequired),
    email: emailSchema,
    password: z
      .string()
      .min(PASSWORD_MIN_LENGTH, strings.validation.passwordTooShort(PASSWORD_MIN_LENGTH))
      .max(PASSWORD_MAX_LENGTH, strings.validation.passwordTooLong(PASSWORD_MAX_LENGTH)),
    confirmPassword: z.string().min(1, strings.validation.confirmPasswordRequired),
  })
  .refine(values => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    message: strings.validation.passwordsDontMatch,
  });

export type RegisterFormValues = z.infer<typeof registerSchema>;
