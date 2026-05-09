import Toast from 'react-native-toast-message';

/**
 * App-wide toast helper. Wraps react-native-toast-message so we can swap the
 * underlying lib later (e.g. for `burnt`'s native UI) without touching callers.
 *
 * Pair with `<Toast />` rendered once at the root layout.
 */
export const toast = {
  error: (message: string) => Toast.show({ type: 'error', text1: message }),
  success: (message: string) => Toast.show({ type: 'success', text1: message }),
};
