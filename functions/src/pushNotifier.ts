import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import axios from 'axios';

const db = admin.firestore();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserDoc {
  commuteTime: string; // "HH:MM"
  userKey: string;
}

interface RouteDoc {
  districts: string[];
}

interface WeatherAlertDoc {
  hasAlert: boolean;
  alertType?: string;
  alertLevel?: string;
  district?: string;
}

interface NotificationLogEntry {
  userId: string;
  sentAt: FirebaseFirestore.FieldValue;
  alertType: string;
  status: 'sent' | 'failed';
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Returns the current time in KST (UTC+9) as "HH:MM" string.
 */
function getKSTTimeString(): string {
  const now = new Date();
  // UTC time + 9 hours for KST
  const kstOffset = 9 * 60; // minutes
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const kstMinutes = (utcMinutes + kstOffset) % (24 * 60);

  const hours = Math.floor(kstMinutes / 60);
  const minutes = kstMinutes % 60;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Adds minutes to an "HH:MM" time string. Returns "HH:MM".
 * Handles day overflow (wraps around midnight).
 */
function addMinutes(timeStr: string, minutes: number): string {
  const [h, m] = timeStr.split(':').map(Number);
  const totalMinutes = (h * 60 + m + minutes) % (24 * 60);
  const newH = Math.floor(totalMinutes / 60);
  const newM = totalMinutes % 60;

  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}

/**
 * Converts "HH:MM" to total minutes since midnight for comparison.
 */
function timeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Checks if a Firestore Timestamp falls on today (KST).
 */
function isSameDay(timestamp: FirebaseFirestore.Timestamp): boolean {
  const now = new Date();
  const kstOffset = 9 * 60 * 60 * 1000; // ms

  const nowKST = new Date(now.getTime() + kstOffset);
  const tsKST = new Date(timestamp.toMillis() + kstOffset);

  return (
    nowKST.getUTCFullYear() === tsKST.getUTCFullYear() &&
    nowKST.getUTCMonth() === tsKST.getUTCMonth() &&
    nowKST.getUTCDate() === tsKST.getUTCDate()
  );
}

/**
 * Normalise a district name to match weatherAlerts document IDs.
 * Must match the regionToDocId logic in weatherCollectorBatch.ts.
 */
function districtToDocId(district: string): string {
  return district.replace(/\//g, '_').replace(/\s+/g, '_');
}

// ---------------------------------------------------------------------------
// Main Cloud Function (runs every 1 minute)
// ---------------------------------------------------------------------------

export const pushNotifier = onSchedule(
  {
    schedule: 'every 1 minutes',
    timeoutSeconds: 120,
    memory: '256MiB',
    secrets: ['KAKAO_REST_KEY'],
  },
  async () => {
    const currentKST = getKSTTimeString();
    const targetTime = addMinutes(currentKST, 30);

    console.log(
      `[PushNotifier] Running at KST ${currentKST}, targeting commute time ~${targetTime}`,
    );

    // -------------------------------------------------------------------
    // 1. Query users whose commuteTime is within +/- 2 minutes of target
    // -------------------------------------------------------------------
    const targetMinutes = timeToMinutes(targetTime);
    const windowMin = targetMinutes - 2;
    const windowMax = targetMinutes + 2;

    // Build the set of valid "HH:MM" strings within the window
    const validTimes = new Set<string>();
    for (let m = windowMin; m <= windowMax; m++) {
      const adjusted = ((m % (24 * 60)) + 24 * 60) % (24 * 60);
      const hh = String(Math.floor(adjusted / 60)).padStart(2, '0');
      const mm = String(adjusted % 60).padStart(2, '0');
      validTimes.add(`${hh}:${mm}`);
    }

    // Firestore doesn't support range queries on "HH:MM" strings well,
    // so we query with 'in' operator for the exact time strings in the window.
    // The 'in' operator supports up to 30 values — we have at most 5.
    const timeArray = Array.from(validTimes);

    let userSnapshots: FirebaseFirestore.QuerySnapshot;
    try {
      userSnapshots = await db
        .collection('users')
        .where('commuteTime', 'in', timeArray)
        .get();
    } catch (err) {
      console.error('[PushNotifier] Failed to query users:', err);
      return;
    }

    if (userSnapshots.empty) {
      console.log('[PushNotifier] No users matched for commute window');
      return;
    }

    console.log(
      `[PushNotifier] Found ${userSnapshots.size} user(s) in commute window [${timeArray.join(', ')}]`,
    );

    // -------------------------------------------------------------------
    // 2. Process each user
    // -------------------------------------------------------------------
    let sentCount = 0;
    let failCount = 0;

    for (const userSnap of userSnapshots.docs) {
      try {
        const userId = userSnap.id;
        const userData = userSnap.data() as UserDoc;

        if (!userData.userKey) {
          console.warn(`[PushNotifier] User ${userId} has no userKey, skipping`);
          continue;
        }

        // ---------------------------------------------------------------
        // 2a. Read the user's route to get districts
        // ---------------------------------------------------------------
        const routeSnap = await db.collection('routes').doc(userId).get();
        if (!routeSnap.exists) {
          console.log(`[PushNotifier] No route for user ${userId}, skipping`);
          continue;
        }

        const routeData = routeSnap.data() as RouteDoc;
        const districts = routeData.districts ?? [];
        if (districts.length === 0) {
          console.log(`[PushNotifier] User ${userId} route has no districts, skipping`);
          continue;
        }

        // ---------------------------------------------------------------
        // 2b. Check weatherAlerts for each district
        // ---------------------------------------------------------------
        let activeAlert: WeatherAlertDoc | null = null;
        let alertDistrict = '';

        for (const district of districts) {
          const docId = districtToDocId(district);
          const alertSnap = await db
            .collection('weatherAlerts')
            .doc(docId)
            .get();

          if (alertSnap.exists) {
            const alertData = alertSnap.data() as WeatherAlertDoc;
            if (alertData.hasAlert === true) {
              activeAlert = alertData;
              alertDistrict = district;
              break; // One alert is enough to trigger notification
            }
          }
        }

        if (!activeAlert) {
          continue; // No active alerts on this user's route
        }

        // ---------------------------------------------------------------
        // 2c. Check for duplicate notification today
        // ---------------------------------------------------------------
        const existingLogs = await db
          .collection('notificationLog')
          .where('userId', '==', userId)
          .where('status', '==', 'sent')
          .orderBy('sentAt', 'desc')
          .limit(1)
          .get();

        let alreadySentToday = false;
        if (!existingLogs.empty) {
          const lastLog = existingLogs.docs[0].data();
          if (lastLog.sentAt && isSameDay(lastLog.sentAt as FirebaseFirestore.Timestamp)) {
            alreadySentToday = true;
          }
        }

        if (alreadySentToday) {
          console.log(`[PushNotifier] Already sent to user ${userId} today, skipping`);
          continue;
        }

        // ---------------------------------------------------------------
        // 2d. Send notification via Apps-in-Toss Smart Send API
        // ---------------------------------------------------------------
        let status: 'sent' | 'failed' = 'sent';
        try {
          await axios.post(
            'https://api-partner.toss.im/v1/apps-in-toss/messenger/send-message',
            {
              templateSetCode: 'ROADGUARD_HAZARD_ALERT',
              context: {
                routeName: '집 \u2192 회사',
                alertType: `${activeAlert.alertType ?? '기상'} ${activeAlert.alertLevel ?? '주의보'}`,
                district: alertDistrict,
              },
            },
            {
              headers: {
                'x-toss-user-key': userData.userKey,
                'Content-Type': 'application/json',
              },
              timeout: 10000,
            },
          );

          sentCount++;
          console.log(`[PushNotifier] Sent notification to user ${userId} for ${alertDistrict}`);
        } catch (apiErr) {
          status = 'failed';
          failCount++;
          console.error(
            `[PushNotifier] Smart Send API failed for user ${userId}:`,
            apiErr instanceof Error ? apiErr.message : apiErr,
          );
        }

        // ---------------------------------------------------------------
        // 2e. Log the notification attempt
        // ---------------------------------------------------------------
        const logEntry: NotificationLogEntry = {
          userId,
          sentAt: admin.firestore.FieldValue.serverTimestamp(),
          alertType: `${activeAlert.alertType ?? '기상'} ${activeAlert.alertLevel ?? '주의보'}`,
          status,
        };

        await db.collection('notificationLog').add(logEntry);
      } catch (userErr) {
        failCount++;
        console.error(
          `[PushNotifier] Error processing user ${userSnap.id}:`,
          userErr instanceof Error ? userErr.message : userErr,
        );
      }
    }

    // -------------------------------------------------------------------
    // 3. Summary
    // -------------------------------------------------------------------
    console.log(
      `[PushNotifier] Processed ${userSnapshots.size} users, sent ${sentCount} notifications, ${failCount} failures`,
    );
  },
);
