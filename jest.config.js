/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFiles: ['<rootDir>/jest.setup.js'],
  // jest-expo's allowlist + @supabase/* so its ESM bundles get transformed.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@supabase/.*)',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/.expo/', '/dist/', '/supabase/'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
};
