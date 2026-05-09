import { signIn, signOut, signUp, translateAuthError } from '../lib/auth-actions';
import { supabase } from '../lib/supabase';

jest.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      signUp: jest.fn(),
      signInWithPassword: jest.fn(),
      signOut: jest.fn(),
    },
  },
}));

const mockAuth = (supabase as unknown as {
  auth: {
    signUp: jest.Mock;
    signInWithPassword: jest.Mock;
    signOut: jest.Mock;
  };
}).auth;

describe('auth-actions', () => {
  // The implementation deliberately console.errors the original Supabase
  // error in dev so we can debug — silence it in tests to keep output clean.
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('signUp', () => {
    it('passes display_name and color via raw_user_meta_data', async () => {
      mockAuth.signUp.mockResolvedValue({ error: null });
      await signUp({
        email: 'alice@example.com',
        password: 'correct-horse',
        displayName: 'Alice',
        color: '#FF6B6B',
      });
      expect(mockAuth.signUp).toHaveBeenCalledWith({
        email: 'alice@example.com',
        password: 'correct-horse',
        options: { data: { display_name: 'Alice', color: '#FF6B6B' } },
      });
    });

    it('returns null error on success', async () => {
      mockAuth.signUp.mockResolvedValue({ error: null });
      const result = await signUp({
        email: 'a@b.com',
        password: 'pw1234',
        displayName: 'A',
        color: '#000000',
      });
      expect(result.error).toBeNull();
    });

    it('returns translated error on weak_password', async () => {
      mockAuth.signUp.mockResolvedValue({
        error: { code: 'weak_password', message: 'too weak' },
      });
      const result = await signUp({
        email: 'a@b.com',
        password: '1',
        displayName: 'A',
        color: '#000000',
      });
      expect(result.error).toMatch(/at least/i);
    });

    it('returns translated error on user_already_exists', async () => {
      mockAuth.signUp.mockResolvedValue({
        error: { code: 'user_already_exists', message: 'taken' },
      });
      const result = await signUp({
        email: 'a@b.com',
        password: 'pw1234',
        displayName: 'A',
        color: '#000000',
      });
      expect(result.error).toMatch(/already exists/i);
    });

    it('returns generic error for unknown code', async () => {
      mockAuth.signUp.mockResolvedValue({
        error: { code: 'something_unexpected', message: 'boom' },
      });
      const result = await signUp({
        email: 'a@b.com',
        password: 'pw1234',
        displayName: 'A',
        color: '#000000',
      });
      expect(result.error).toMatch(/something went wrong/i);
    });
  });

  describe('signIn', () => {
    it('calls signInWithPassword with email and password', async () => {
      mockAuth.signInWithPassword.mockResolvedValue({ error: null });
      await signIn({ email: 'alice@example.com', password: 'correct-horse' });
      expect(mockAuth.signInWithPassword).toHaveBeenCalledWith({
        email: 'alice@example.com',
        password: 'correct-horse',
      });
    });

    it('returns translated error on invalid_credentials', async () => {
      mockAuth.signInWithPassword.mockResolvedValue({
        error: { code: 'invalid_credentials', message: 'no' },
      });
      const result = await signIn({ email: 'a@b.com', password: 'bad' });
      expect(result.error).toMatch(/wrong email or password/i);
    });
  });

  describe('signOut', () => {
    it('calls supabase.auth.signOut', async () => {
      mockAuth.signOut.mockResolvedValue({ error: null });
      await signOut();
      expect(mockAuth.signOut).toHaveBeenCalled();
    });

    it('returns null error on success', async () => {
      mockAuth.signOut.mockResolvedValue({ error: null });
      const result = await signOut();
      expect(result.error).toBeNull();
    });
  });

  describe('translateAuthError', () => {
    it('translates invalid_credentials', () => {
      expect(translateAuthError({ code: 'invalid_credentials', message: '' } as never))
        .toMatch(/wrong email or password/i);
    });

    it('falls back for unknown codes', () => {
      expect(translateAuthError({ code: 'mystery_code', message: 'x' } as never))
        .toMatch(/something went wrong/i);
    });

    it('handles errors without a code', () => {
      expect(translateAuthError({ message: 'no code at all' } as never))
        .toMatch(/something went wrong/i);
    });
  });
});
