/**
 * Session Worker Function
 *
 * Pub/Sub-triggered function that:
 * 1. Manages canvas sessions (start, pause, reset)
 * 2. Updates session state in Firestore
 * 3. Handles canvas resets
 */

const functions = require('@google-cloud/functions-framework');
const { Firestore } = require('@google-cloud/firestore');

const PROJECT_ID = process.env.PROJECT_ID;

const firestore = new Firestore({ projectId: PROJECT_ID });

/**
 * Start a new session
 */
async function startSession(metadata) {
  try {
    const sessionRef = firestore.collection('sessions').doc('current');

    await sessionRef.set({
      status: 'active',
      startedAt: new Date().toISOString(),
      canvasWidth: metadata.canvasWidth || null,
      canvasHeight: metadata.canvasHeight || null,
      createdBy: metadata.userId,
      createdByUsername: metadata.username
    });

    console.log('Session started');
    return true;
  } catch (error) {
    console.error('Failed to start session:', error);
    return false;
  }
}

/**
 * Pause the current session
 */
async function pauseSession() {
  try {
    const sessionRef = firestore.collection('sessions').doc('current');

    await sessionRef.update({
      status: 'paused',
      pausedAt: new Date().toISOString()
    });

    console.log('Session paused');
    return true;
  } catch (error) {
    console.error('Failed to pause session:', error);
    return false;
  }
}

/**
 * Reset the canvas (delete all pixels)
 */
async function resetCanvas() {
  try {
    console.log('Resetting canvas - deleting all pixels');

    // Delete all pixels in batches
    const batchSize = 500;
    const pixelsRef = firestore.collection('pixels');

    let deletedCount = 0;

    while (true) {
      const snapshot = await pixelsRef.limit(batchSize).get();

      if (snapshot.empty) {
        break;
      }

      const batch = firestore.batch();
      snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });

      await batch.commit();
      deletedCount += snapshot.size;

      console.log(`Deleted ${deletedCount} pixels so far...`);
    }

    // Update session
    const sessionRef = firestore.collection('sessions').doc('current');
    await sessionRef.update({
      status: 'active',
      resetAt: new Date().toISOString(),
      pixelsCleared: deletedCount
    });

    console.log(`Canvas reset complete. Deleted ${deletedCount} pixels`);
    return true;
  } catch (error) {
    console.error('Failed to reset canvas:', error);
    return false;
  }
}

/**
 * End the current session
 */
async function endSession() {
  try {
    const sessionRef = firestore.collection('sessions').doc('current');
    const sessionDoc = await sessionRef.get();

    if (sessionDoc.exists) {
      const sessionData = sessionDoc.data();

      // Archive the current session
      await firestore.collection('sessions').doc(`archive_${Date.now()}`).set({
        ...sessionData,
        status: 'ended',
        endedAt: new Date().toISOString()
      });

      // Clear current session
      await sessionRef.delete();
    }

    console.log('Session ended');
    return true;
  } catch (error) {
    console.error('Failed to end session:', error);
    return false;
  }
}

/**
 * CloudEvent function handler (Pub/Sub)
 */
functions.cloudEvent('handler', async (cloudEvent) => {
  console.log('Session command received');

  try {
    const data = cloudEvent.data.message.data;
    const messageData = JSON.parse(Buffer.from(data, 'base64').toString());

    const { action, userId, username } = messageData;

    console.log(`Processing session action: ${action} by ${username}`);

    let success = false;

    switch (action) {
      case 'start':
        success = await startSession({ userId, username });
        break;

      case 'pause':
        success = await pauseSession();
        break;

      case 'reset':
        success = await resetCanvas();
        break;

      case 'end':
        success = await endSession();
        break;

      default:
        console.error('Unknown session action:', action);
        return;
    }

    if (success) {
      console.log(`Session action '${action}' completed successfully`);
    } else {
      console.error(`Session action '${action}' failed`);
      throw new Error(`Failed to execute session action: ${action}`);
    }
  } catch (error) {
    console.error('Error processing session command:', error);
    throw error; // Trigger retry
  }
});
