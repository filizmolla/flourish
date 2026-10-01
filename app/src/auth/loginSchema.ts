import { z } from 'zod';
import { strings } from '../strings';

export const emailSchema = z
  .string()
  .trim()
  .min(1, strings.validation.emailRequired)
  .pipe(z.email(strings.validation.emailInvalid));

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, strings.validation.passwordRequired),
});

export type LoginFormValues = z.infer<typeof loginSchema>;
