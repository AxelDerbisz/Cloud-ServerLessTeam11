/**
 * Session Worker Function
 *
 * Pub/Sub-triggered function that:
 * 1. Manages canvas sessions (start, pause, reset)
 * 2. Updates session state in Firestore
 * 3. Handles canvas resets
 * 4. Sends Discord follow-up messages
 */

// Initialize tracing before other imports
const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const { SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { TraceExporter } = require('@google-cloud/opentelemetry-cloud-trace-exporter');
const { Resource } = require('@opentelemetry/resources');
const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');
const { trace, SpanStatusCode, context } = require('@opentelemetry/api');

const tracerProvider = new NodeTracerProvider({
  resource: new Resource({ [ATTR_SERVICE_NAME]: 'session-worker' }),
});
tracerProvider.addSpanProcessor(new SimpleSpanProcessor(new TraceExporter({ projectId: process.env.PROJECT_ID })));
tracerProvider.register();

const tracer = trace.getTracer('session-worker');

function logJson(severity, message, fields = {}) {
  console.log(JSON.stringify({ severity, message, ...fields }));
}

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

    return { success: true, message: `✅ Session started successfully (${canvasWidth}x${canvasHeight})` };
  } catch (error) {
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

    return { success: true, message: '⏸️ Session paused' };
  } catch (error) {
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

    return { success: true, message: '▶️ Session resumed' };
  } catch (error) {
    return { success: false, message: `❌ Failed to resume session: ${error.message}` };
  }
}

/**
 * Reset the canvas (delete all pixels)
 */
async function resetCanvas() {
  try {
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
    }

    // Update session
    const sessionRef = firestore.collection('sessions').doc('current');
    await sessionRef.update({
      status: 'active',
      resetAt: new Date().toISOString(),
      pixelsCleared: deletedCount
    });

    return { success: true, message: `🔄 Canvas reset complete. Deleted ${deletedCount} pixels` };
  } catch (error) {
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

    return { success: true, message: '🛑 Session ended and archived' };
  } catch (error) {
    return { success: false, message: `❌ Failed to end session: ${error.message}` };
  }
}

/**
 * Get canvas status
 */
async function getCanvasStatus() {
  try {
    const sessionRef = firestore.collection('sessions').doc('current');
    const sessionDoc = await sessionRef.get();

    if (!sessionDoc.exists) {
      return { success: true, message: 'No active session found.' };
    }

    const session = sessionDoc.data();
    const status = session.status || 'unknown';
    const startedAt = session.startedAt || 'N/A';
    const canvasWidth = session.canvasWidth || '∞';
    const canvasHeight = session.canvasHeight || '∞';

    // Count pixels
    const pixelCountQuery = await firestore.collection('pixels').count().get();
    const pixelCount = pixelCountQuery.data().count;

    return {
      success: true,
      message: `**Canvas Status**\nStatus: ${status}\nStarted: ${startedAt}\nSize: ${canvasWidth} x ${canvasHeight}\nTotal Pixels: ${pixelCount}`
    };
  } catch (error) {
    return { success: false, message: `❌ Failed to get canvas status: ${error.message}` };
  }
}

/**
 * CloudEvent function handler (Pub/Sub)
 */
functions.cloudEvent('handler', async (cloudEvent) => {
  // Extract trace context from Pub/Sub message attributes
  const attributes = cloudEvent.data.message.attributes || {};
  let parentContext = context.active();
  
  if (attributes.traceId && attributes.spanId) {
    // Create remote span context from propagated IDs
    const remoteSpanContext = {
      traceId: attributes.traceId,
      spanId: attributes.spanId,
      traceFlags: 1, // sampled
      isRemote: true,
    };
    parentContext = trace.setSpanContext(context.active(), remoteSpanContext);
  }

  const span = tracer.startSpan('processSessionCommand', {}, parentContext);
  const activeContext = trace.setSpan(parentContext, span);

  try {
    const data = cloudEvent.data.message.data;
    const messageData = JSON.parse(Buffer.from(data, 'base64').toString());

    const { action, userId, username, interactionToken, applicationId, canvasWidth, canvasHeight } = messageData;

    // Add span attributes
    span.setAttributes({
      'session.action': action,
      'session.user_id': userId,
      'session.username': username,
    });

    let result;

    logJson('INFO', 'session_command_received', { action, user_id: userId, username });

    switch (action) {
      case 'start':
        span.updateName('session.start');
        if (canvasWidth) span.setAttribute('session.canvas_width', canvasWidth);
        if (canvasHeight) span.setAttribute('session.canvas_height', canvasHeight);
        result = await startSession({ userId, username, canvasWidth, canvasHeight });
        break;

      case 'pause':
        span.updateName('session.pause');
        result = await pauseSession();
        break;

      case 'resume':
        span.updateName('session.resume');
        result = await resumeSession();
        break;

      case 'reset':
        span.updateName('session.reset');
        result = await resetCanvas();
        break;

      case 'end':
        span.updateName('session.end');
        result = await endSession();
        break;

      case 'status':
        span.updateName('session.status');
        result = await getCanvasStatus();
        break;

      default:
        result = { success: false, message: `❌ Unknown action: ${action}` };
        span.setStatus({ code: SpanStatusCode.ERROR, message: `Unknown action: ${action}` });
    }

    // Send Discord follow-up
    if (interactionToken && applicationId) {
      await sendDiscordFollowUp(applicationId, interactionToken, result.message);
    }

    if (result.success) {
      logJson('INFO', 'session_command_success', { action, user_id: userId });
      span.setStatus({ code: SpanStatusCode.OK });
    } else {
      logJson('ERROR', 'session_command_failed', { action, user_id: userId, error: result.message });
      span.setStatus({ code: SpanStatusCode.ERROR, message: result.message });
      throw new Error(result.message);
    }
  } catch (error) {
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    throw error; // Trigger retry
  } finally {
    span.end();
    // Flush traces before function exits (required for serverless)
    try {
      await tracerProvider.forceFlush();
    } catch (flushError) {
    }
  }
});
