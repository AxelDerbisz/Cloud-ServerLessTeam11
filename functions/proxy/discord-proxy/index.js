const functions = require('@google-cloud/functions-framework');
const { PubSub } = require('@google-cloud/pubsub');
const { Firestore } = require('@google-cloud/firestore');
const nacl = require('tweetnacl');

const PROJECT_ID = process.env.PROJECT_ID;
const DISCORD_PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;
const PIXEL_EVENTS_TOPIC = process.env.PIXEL_EVENTS_TOPIC || 'pixel-events';
const SNAPSHOT_EVENTS_TOPIC = process.env.SNAPSHOT_EVENTS_TOPIC || 'snapshot-events';
const SESSION_EVENTS_TOPIC = process.env.SESSION_EVENTS_TOPIC || 'session-events';

const pubsub = new PubSub({ projectId: PROJECT_ID });
const firestore = new Firestore({ projectId: PROJECT_ID, databaseId: 'team11-database' });

const DISCORD_API_ENDPOINT = 'https://discord.com/api/v10';
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

// Admin role IDs for permission checks
const ADMIN_ROLE_IDS = process.env.ADMIN_ROLE_IDS?.split(',') || [];

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
 * Check if user has admin role
 */
function isAdmin(member) {
  if (!member || !member.roles) return false;
  return member.roles.some(roleId => ADMIN_ROLE_IDS.includes(roleId));
}

/**
 * Send follow-up message to Discord
 */
async function sendFollowUp(applicationId, token, content) {
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
    console.error('Failed to send follow-up:', error);
    return false;
  }
}

/**
 * Handle /canvas command directly (read-only, no async processing needed)
 */
async function handleCanvas(interaction) {
  try {
    const sessionDoc = await firestore.collection('sessions').doc('current').get();

    if (!sessionDoc.exists) {
      await sendFollowUp(
        interaction.application_id,
        interaction.token,
        'No active session found.'
      );
      return;
    }

    const session = sessionDoc.data();
    const pixelsSnapshot = await firestore.collection('pixels').count().get();
    const pixelCount = pixelsSnapshot.data().count;

    const message = `**Canvas Status**
Status: ${session.status}
Started: ${session.startedAt || 'N/A'}
Size: ${session.canvasWidth || '∞'} x ${session.canvasHeight || '∞'}
Total Pixels: ${pixelCount}`;

    await sendFollowUp(
      interaction.application_id,
      interaction.token,
      message
    );
  } catch (error) {
    console.error('Error getting canvas:', error);
    await sendFollowUp(
      interaction.application_id,
      interaction.token,
      'Failed to get canvas information.'
    );
  }
}

/**
 * Route /draw command to pixel-events topic
 */
async function routeDrawCommand(interaction) {
  const options = interaction.data.options.reduce((acc, opt) => {
    acc[opt.name] = opt.value;
    return acc;
  }, {});

  const messageData = {
    x: parseInt(options.x),
    y: parseInt(options.y),
    color: options.color.replace('#', '').toUpperCase(),
    userId: interaction.member.user.id,
    username: interaction.member.user.username,
    source: 'discord',
    // Include Discord interaction info for follow-up
    interactionToken: interaction.token,
    applicationId: interaction.application_id,
    timestamp: new Date().toISOString()
  };

  await pubsub.topic(PIXEL_EVENTS_TOPIC).publishMessage({
    data: Buffer.from(JSON.stringify(messageData)),
    attributes: { type: 'pixel_placement', source: 'discord' }
  });

  console.log(`Draw command routed to ${PIXEL_EVENTS_TOPIC}`);
}

/**
 * Route /snapshot command to snapshot-events topic
 */
async function routeSnapshotCommand(interaction) {
  if (!isAdmin(interaction.member)) {
    await sendFollowUp(
      interaction.application_id,
      interaction.token,
      '❌ You do not have permission to create snapshots.'
    );
    return false;
  }

  const messageData = {
    channelId: interaction.channel_id,
    userId: interaction.member.user.id,
    username: interaction.member.user.username,
    interactionToken: interaction.token,
    applicationId: interaction.application_id,
    timestamp: new Date().toISOString()
  };

  await pubsub.topic(SNAPSHOT_EVENTS_TOPIC).publishMessage({
    data: Buffer.from(JSON.stringify(messageData)),
    attributes: { type: 'snapshot_request' }
  });

  console.log(`Snapshot command routed to ${SNAPSHOT_EVENTS_TOPIC}`);
  return true;
}

/**
 * Route /session command to session-events topic
 */
async function routeSessionCommand(interaction) {
  if (!isAdmin(interaction.member)) {
    await sendFollowUp(
      interaction.application_id,
      interaction.token,
      'You do not have permission to manage sessions.'
    );
    return false;
  }

  const subcommand = interaction.data.options[0].name;

  const messageData = {
    action: subcommand,
    userId: interaction.member.user.id,
    username: interaction.member.user.username,
    interactionToken: interaction.token,
    applicationId: interaction.application_id,
    timestamp: new Date().toISOString()
  };

  await pubsub.topic(SESSION_EVENTS_TOPIC).publishMessage({
    data: Buffer.from(JSON.stringify(messageData)),
    attributes: { type: 'session_command' }
  });

  console.log(`Session command (${subcommand}) routed to ${SESSION_EVENTS_TOPIC}`);
  return true;
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

    // Only handle application commands (type 2)
    if (req.body.type !== 2) {
      console.log('Ignoring non-command interaction type:', req.body.type);
      return res.status(200).json({ type: 1 });
    }

    const interaction = req.body;
    const commandName = interaction.data.name;

    console.log(`Processing command: /${commandName}`);

    // Handle /canvas directly (synchronous read)
    if (commandName === 'canvas') {
      // Acknowledge with deferred response
      res.status(200).json({ type: 5 });
      await handleCanvas(interaction);
      return;
    }

    // For async commands, acknowledge immediately then route
    res.status(200).json({ type: 5 });

    // Route to appropriate topic
    switch (commandName) {
      case 'draw':
        await routeDrawCommand(interaction);
        break;

      case 'snapshot':
        await routeSnapshotCommand(interaction);
        break;

      case 'session':
        await routeSessionCommand(interaction);
        break;

      default:
        console.log('Unknown command:', commandName);
        await sendFollowUp(
          interaction.application_id,
          interaction.token,
          'Unknown command.'
        );
    }
  } catch (error) {
    console.error('Error processing request:', error);
    if (!res.headersSent) {
      return res.status(500).send('Internal Server Error');
    }
  }
});
