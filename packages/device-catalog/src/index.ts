export * from './schema/raw.js';
export * from './providers/index.js';
export * from './normalizer/index.js';
export * from './query.js';
export * from './load.js';

import { appleProvider } from './providers/apple.js';
import { androidProvider } from './providers/android.js';
import type { DeviceDataProvider } from './schema/raw.js';

/** The providers the scheduled sync runs by default. */
export const defaultProviders: DeviceDataProvider[] = [appleProvider, androidProvider];
