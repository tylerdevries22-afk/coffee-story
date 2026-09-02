const { withMainActivity } = require('@expo/config-plugins');

const IMPORT = 'import com.oney.WebRTCModule.WebRTCModuleOptions';
const ENABLE = 'WebRTCModuleOptions.getInstance().enableMediaProjectionService = true';

/** Enables react-native-webrtc's Android 14 MediaProjection foreground service. */
module.exports = function withMediaProjection(config) {
  return withMainActivity(config, (result) => {
    if (result.modResults.language !== 'kt') {
      throw new Error('Device Wall requires a Kotlin MainActivity.');
    }
    let source = result.modResults.contents;
    if (!source.includes(IMPORT)) {
      const packageLine = source.match(/^package .+$/m)?.[0];
      if (!packageLine) throw new Error('MainActivity package declaration is missing.');
      source = source.replace(packageLine, `${packageLine}\n\n${IMPORT}`);
    }
    if (!source.includes(ENABLE)) {
      const superCall = 'super.onCreate(savedInstanceState)';
      if (!source.includes(superCall)) throw new Error('MainActivity onCreate is missing.');
      source = source.replace(superCall, `${superCall}\n    ${ENABLE}`);
    }
    result.modResults.contents = source;
    return result;
  });
};
