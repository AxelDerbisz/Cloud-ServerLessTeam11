/**
 * Discord Proxy Function
 *
 * HTTP-triggered function that:
 * 1. Verifies Discord webhook signature
 * 2. Acknowledges the request immediately (within 3 seconds)
 * 3. Publishes the event to Pub/Sub for asynchronous processing
 */

const functions = require('@google-cloud/functions-framework');
const { PubSub } = require('@google-cloud/pubsub');
const nacl = require('tweetnacl');

const PROJECT_ID = process.env.PROJECT_ID;
const DISCORD_COMMANDS_TOPIC = process.env.DISCORD_COMMANDS_TOPIC;
const DISCORD_PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;

const pubsub = new PubSub({ projectId: PROJECT_ID });


function verifyDiscordSignature(signature, timestamp, body) {
  if (!DISCORD_PUBLIC_KEY) {
    console.error('DISCORD_PUBLIC_KEY not configured');
    return false;
  }

  try {
    const message = Buffer.from(timestamp + body);
    const signatureBuffer = Buffer.from(signature, 'hex');
    const publicKeyBuffer = Buffer.from(DISCORD_PUBLIC_KEY, 'hex');

    return nacl.sign.detached.verify(message, signatureBuffer, publicKeyBuffer);
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

/**
 * HTTP function handler
 */
functions.http('handler', async (req, res) => {
  console.log('Discord webhook received', { method: req.method, hasBody: !!req.body });

  try {
    // Only accept POST requests
    if (req.method !== 'POST') {
      return res.status(405).send('Method Not Allowed');
    }

    // Get raw body for signature verification
    const rawBody = req.rawBody ? req.rawBody.toString() : JSON.stringify(req.body);
    console.log('Request body type:', req.body?.type);

    // Verify signature
    const signature = req.headers['x-signature-ed25519'];
    const timestamp = req.headers['x-signature-timestamp'];

    if (!signature || !timestamp) {
      console.error('Missing signature headers');
      return res.status(401).send('Unauthorized');
    }

    // Verify Ed25519 signature
    if (!verifyDiscordSignature(signature, timestamp, rawBody)) {
      console.error('Invalid signature');
      return res.status(401).send('Invalid signature');
    }

    console.log('Signature verified successfully');

    // Handle Discord ping
    if (req.body.type === 1) {
      console.log('Discord ping received, responding with type 1');
      return res.status(200).json({ type: 1 });
    }
  } catch (error) {
    console.error('Error processing request:', error);
    return res.status(500).send('Internal Server Error');
  }

  // Acknowledge immediately
  res.status(200).json({
    type: 5, // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
    data: {
      content: 'Processing your request...'
    }
  });

  // Publish to Pub/Sub for async processing
  try {
    const messageData = {
      type: req.body.type,
      data: req.body.data,
      member: req.body.member,
      guild_id: req.body.guild_id,
      channel_id: req.body.channel_id,
      token: req.body.token,
      id: req.body.id,
      application_id: req.body.application_id,
      timestamp: new Date().toISOString()
    };

    const dataBuffer = Buffer.from(JSON.stringify(messageData));
    await pubsub.topic(DISCORD_COMMANDS_TOPIC).publishMessage({
      data: dataBuffer,
      attributes: {
        type: 'discord_interaction',
        interaction_type: String(req.body.type)
      }
    });

    console.log('Event published to Pub/Sub');
  } catch (error) {
    console.error('Failed to publish to Pub/Sub:', error);
    // Don't fail the request since we already responded
  }
});
