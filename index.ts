import { registerRootComponent } from 'expo';

// First, so crashes while the rest loads are reported (no-op without a DSN).
import './src/sentry';
import './src/tasks/locationTask';
import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
