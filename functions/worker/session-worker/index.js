/**
 * Session Worker Function
 *
 * Pub/Sub-triggered function that:
 * 1. Manages canvas sessions (start, pause, reset)
 * 2. Updates session state in Firestore
 * 3. Handles canvas resets
 * 4. Sends Discord follow-up messages
 */

const functions = require('@google-cloud/functions-framework');
const { Firestore } = require('@google-cloud/firestore');

const PROJECT_ID = process.env.PROJECT_ID;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

const firestore = new Firestore({ projectId: PROJECT_ID, databaseId: 'team11-database' });

const DISCORD_API_ENDPOINT = 'https://discord.com/api/v10';

/**
 * Send follow-up message to Discord
 */
async function sendDiscordFollowUp(applicationId, token, content) {
  if (!applicationId || !token || !DISCORD_BOT_TOKEN) {
    console.log('Discord follow-up skipped: missing credentials');
    return false;
  }

  try {
    const response = await fetch(
      `${DISCORD_API_ENDPOINT}/webhooks/${applicationId}/${token}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bot ${DISCORD_BOT_TOKEN}`
        },
        body: JSON.stringify({ content })
      }
    );

    if (!response.ok) {
      throw new Error(`Discord API error: ${response.status}`);
    }
    return true;
  } catch (error) {
    console.error('Failed to send Discord follow-up:', error);
    return false;
  }
}

/**
 * Start a new session
 */
async function startSession(metadata) {
  try {
    const sessionRef = firestore.collection('sessions').doc('current');

    const canvasWidth = metadata.canvasWidth || 100;
    const canvasHeight = metadata.canvasHeight || 100;

    await sessionRef.set({
      status: 'active',
      startedAt: new Date().toISOString(),
      canvasWidth: canvasWidth,
      canvasHeight: canvasHeight,
      createdBy: metadata.userId,
      createdByUsername: metadata.username
    });

    console.log(`Session started with dimensions: ${canvasWidth}x${canvasHeight}`);
    return { success: true, message: `✅ Session started successfully (${canvasWidth}x${canvasHeight})` };
  } catch (error) {
    console.error('Failed to start session:', error);
    return { success: false, message: `❌ Failed to start session: ${error.message}` };
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
    return { success: true, message: '⏸️ Session paused' };
  } catch (error) {
    console.error('Failed to pause session:', error);
    return { success: false, message: `❌ Failed to pause session: ${error.message}` };
  }
}

/**
 * Resume the current session
 */
async function resumeSession() {
  try {
    const sessionRef = firestore.collection('sessions').doc('current');

    await sessionRef.update({
      status: 'active',
      resumedAt: new Date().toISOString()
    });

    console.log('Session resumed');
    return { success: true, message: '▶️ Session resumed' };
  } catch (error) {
    console.error('Failed to resume session:', error);
    return { success: false, message: `❌ Failed to resume session: ${error.message}` };
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
    return { success: true, message: `🔄 Canvas reset complete. Deleted ${deletedCount} pixels` };
  } catch (error) {
    console.error('Failed to reset canvas:', error);
    return { success: false, message: `❌ Failed to reset canvas: ${error.message}` };
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
    return { success: true, message: '🛑 Session ended and archived' };
  } catch (error) {
    console.error('Failed to end session:', error);
    return { success: false, message: `❌ Failed to end session: ${error.message}` };
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

    const { action, userId, username, interactionToken, applicationId, canvasWidth, canvasHeight } = messageData;

    console.log(`Processing session action: ${action} by ${username}`);

    let result;

    switch (action) {
      case 'start':
        result = await startSession({ userId, username, canvasWidth, canvasHeight });
        break;

      case 'pause':
        result = await pauseSession();
        break;

      case 'resume':
        result = await resumeSession();
        break;

      case 'reset':
        result = await resetCanvas();
        break;

      case 'end':
        result = await endSession();
        break;

      default:
        console.error('Unknown session action:', action);
        result = { success: false, message: `❌ Unknown action: ${action}` };
    }

    // Send Discord follow-up
    if (interactionToken && applicationId) {
      await sendDiscordFollowUp(applicationId, interactionToken, result.message);
    }

    if (result.success) {
      console.log(`Session action '${action}' completed successfully`);
    } else {
      console.error(`Session action '${action}' failed`);
      throw new Error(result.message);
    }
  } catch (error) {
    console.error('Error processing session command:', error);
    throw error; // Trigger retry
  }
});
