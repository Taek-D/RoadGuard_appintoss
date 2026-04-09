import * as admin from 'firebase-admin';

admin.initializeApp();

export { nodeMatcherBatch } from './nodeMatcherBatch';
export { weatherCollectorBatch } from './weatherCollectorBatch';
export { pushNotifier } from './pushNotifier';
