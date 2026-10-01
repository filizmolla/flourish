import { registerSchema, RegisterFormValues } from './registerSchema';

const valid: RegisterFormValues = {
  name: 'Filiz',
  email: 'filiz@example.com',
  password: 'correct-horse',
  confirmPassword: 'correct-horse',
};

// Returns the first error message for a field, or undefined if it's valid.
function errorFor(values: RegisterFormValues, field: keyof RegisterFormValues) {
  const result = registerSchema.safeParse(values);
  if (result.success) return undefined;
  return result.error.issues.find(issue => issue.path[0] === field)?.message;
}

describe('registerSchema', () => {
  it('accepts valid input and trims name and email', () => {
    const result = registerSchema.parse({ ...valid, name: '  Filiz ', email: ' filiz@example.com ' });
    expect(result.name).toBe('Filiz');
    expect(result.email).toBe('filiz@example.com');
  });

  it('requires a name that is not just whitespace', () => {
    expect(errorFor({ ...valid, name: '   ' }, 'name')).toBe('Name is required');
  });

  it('distinguishes a missing email from a malformed one', () => {
    expect(errorFor({ ...valid, email: '' }, 'email')).toBe('Email is required');
    expect(errorFor({ ...valid, email: 'not-an-email' }, 'email')).toBe(
      'Enter a valid email address',
    );
  });

  it('enforces the 8–128 character password length', () => {
    const short = 'a'.repeat(7);
    const long = 'a'.repeat(129);
    expect(errorFor({ ...valid, password: short, confirmPassword: short }, 'password')).toBe(
      'Password must be at least 8 characters',
    );
    expect(errorFor({ ...valid, password: long, confirmPassword: long }, 'password')).toBe(
      'Password must be at most 128 characters',
    );
  });

  it('reports mismatched passwords on the confirm field', () => {
    expect(errorFor({ ...valid, confirmPassword: 'something-else' }, 'confirmPassword')).toBe(
      'Passwords do not match',
    );
  });
});
