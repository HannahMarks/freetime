// Required for Reanimated 4 + react-native-worklets in Expo SDK 54.
//
// `babel-preset-expo` *should* auto-include the worklets plugin, but in
// practice (especially on the new architecture) the plugin needs to be
// declared explicitly here. Without it, code paths that rely on worklets
// — every gesture-driven Reanimated component, including
// `reanimated-color-picker` — mount fine but crash the first time a
// gesture tries to invoke a worklet.
//
// IMPORTANT: `react-native-worklets/plugin` MUST be the last plugin in
// the array (it relies on having the final word during transformation).
//
// Restart Metro with `--clear` after touching this file.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-worklets/plugin'],
  };
};
