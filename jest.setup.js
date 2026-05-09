// Stub Supabase env vars so `lib/supabase.ts` doesn't throw at import.
// Tests should not hit the real Supabase project — Supabase calls are mocked
// per-test via jest.mock.
process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'sb_test_anon_key';

// SafeAreaProvider needs a host context; stubbing it lets us render screens
// without wrapping every test in <SafeAreaProvider>.
jest.mock('react-native-safe-area-context', () => {
  const inset = { top: 0, right: 0, bottom: 0, left: 0 };
  const Pass = ({ children }) => children;
  return {
    SafeAreaProvider: Pass,
    SafeAreaView: Pass,
    SafeAreaConsumer: ({ children }) => children(inset),
    useSafeAreaInsets: () => inset,
    useSafeAreaFrame: () => ({ x: 0, y: 0, width: 390, height: 844 }),
  };
});

// @testing-library/react-native v12+ ships matchers (toBeOnTheScreen,
// toHaveTextContent, etc.) built in — no need for @testing-library/jest-native.
