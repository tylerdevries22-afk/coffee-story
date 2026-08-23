// The app entry, as a file that exists inside this package.
//
// `"main": "expo-router/entry"` cannot work here. The workspace installs
// hoisted (see .npmrc: Metro needs a flat node_modules), so every dependency
// lives at the workspace root and `apps/<name>/node_modules` holds only the
// @platform links. Metro's dev server resolves the manifest `main` as a path
// RELATIVE to its server root -- which metro.config.js deliberately pins to
// this directory -- so it looked for `./node_modules/expo-router/entry` here
// and 404'd every bundle request with an UnableToResolveError. Expo Go showed
// its error dialog and no app ever rendered on a simulator.
//
// A real file in this package resolves from the server root, and the bare
// specifier below then resolves the ordinary way, walking up to the hoisted
// copy at the workspace root.
import 'expo-router/entry';
