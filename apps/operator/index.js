// The entry lives inside the app so the dev-server bundle URL never has to
// escape the server root: with EXPO_NO_METRO_WORKSPACE_ROOT=1 the hoisted
// expo-router/entry sits two directories up, and metro >= 0.83.8 parses
// request URLs with WHATWG `new URL()`, which normalizes the resulting
// /../../ prefix away before Metro can resolve it.
import 'expo-router/entry';
