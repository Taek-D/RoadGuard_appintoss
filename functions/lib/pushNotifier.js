"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pushNotifier = void 0;
const scheduler_1 = require("firebase-functions/v2/scheduler");
exports.pushNotifier = (0, scheduler_1.onSchedule)('every 1 minutes', async () => {
    // Phase 5: Will implement push notification logic
    console.log('[PushNotifier] Placeholder - not yet implemented');
});
//# sourceMappingURL=pushNotifier.js.map