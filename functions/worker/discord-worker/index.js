/**
 * Discord Worker Function
 *
 * Pub/Sub-triggered function that:
 * 1. Processes Discord slash commands
 * 2. Validates permissions for admin commands
 * 3. Sends responses back to Discord
 * 4. Triggers other events (snapshot, session)
 */

const functions = require('@google-cloud/functions-framework');
const { Firestore } = require('@google-cloud/firestore');
const { PubSub } = require('@google-cloud/pubsub');

const PROJECT_ID = process.env.PROJECT_ID;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const SNAPSHOT_EVENTS_TOPIC = process.env.SNAPSHOT_EVENTS_TOPIC;
const SESSION_EVENTS_TOPIC = process.env.SESSION_EVENTS_TOPIC;

const firestore = new Firestore({ projectId: PROJECT_ID });
const pubsub = new PubSub({ projectId: PROJECT_ID });

const DISCORD_API_ENDPOINT = 'https://discord.com/api/v10';

// Admin role IDs (configure these based on your Discord server)
const ADMIN_ROLE_IDS = process.env.ADMIN_ROLE_IDS?.split(',') || [];

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
        body: JSON.stringify({
          content: content
        })
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
 * Handle /draw command
 */
async function handleDraw(interaction) {
  const { x, y, color } = interaction.data.options.reduce((acc, opt) => {
    acc[opt.name] = opt.value;
    return acc;
  }, {});

  const userId = interaction.member.user.id;
  const username = interaction.member.user.username;

  // TODO: Validate and place pixel
  // For now, just acknowledge
  await sendFollowUp(
    interaction.application_id,
    interaction.token,
    `Pixel placement at (${x}, ${y}) with color ${color} is being processed...`
  );

  console.log(`Draw command: (${x}, ${y}) = ${color} by ${username}`);
}

/**
 * Handle /canvas command
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
    const pixelsSnapshot = await firestore.collection('pixels').limit(10).get();

    const message = `**Canvas Status**
Status: ${session.status}
Started: ${session.startedAt || 'N/A'}
Size: ${session.canvasWidth || '∞'} x ${session.canvasHeight || '∞'}
Total Pixels: ~${pixelsSnapshot.size}`;

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
 * Handle /session command
 */
async function handleSession(interaction) {
  if (!isAdmin(interaction.member)) {
    await sendFollowUp(
      interaction.application_id,
      interaction.token,
      '❌ You do not have permission to manage sessions.'
    );
    return;
  }

  const subcommand = interaction.data.options[0].name;

  // Publish to session events topic
  const messageData = {
    action: subcommand,
    userId: interaction.member.user.id,
    username: interaction.member.user.username,
    timestamp: new Date().toISOString()
  };

  await pubsub.topic(SESSION_EVENTS_TOPIC).publishMessage({
    data: Buffer.from(JSON.stringify(messageData)),
    attributes: { type: 'session_command' }
  });

  await sendFollowUp(
    interaction.application_id,
    interaction.token,
    `Session ${subcommand} command received. Processing...`
  );

  console.log(`Session command: ${subcommand} by ${interaction.member.user.username}`);
}

/**
 * Handle /snapshot command
 */
async function handleSnapshot(interaction) {
  if (!isAdmin(interaction.member)) {
    await sendFollowUp(
      interaction.application_id,
      interaction.token,
      '❌ You do not have permission to create snapshots.'
    );
    return;
  }

  // Publish to snapshot events topic
  const messageData = {
    channelId: interaction.channel_id,
    userId: interaction.member.user.id,
    username: interaction.member.user.username,
    timestamp: new Date().toISOString()
  };

  await pubsub.topic(SNAPSHOT_EVENTS_TOPIC).publishMessage({
    data: Buffer.from(JSON.stringify(messageData)),
    attributes: { type: 'snapshot_request' }
  });

  await sendFollowUp(
    interaction.application_id,
    interaction.token,
    'Generating canvas snapshot... This may take a moment.'
  );

  console.log(`Snapshot requested by ${interaction.member.user.username}`);
}

/**
 * CloudEvent function handler (Pub/Sub)
 */
functions.cloudEvent('handler', async (cloudEvent) => {
  console.log('Discord command received');

  try {
    const data = cloudEvent.data.message.data;
    const interaction = JSON.parse(Buffer.from(data, 'base64').toString());

    // Only handle application commands (type 2)
    if (interaction.type !== 2) {
      console.log('Ignoring non-command interaction');
      return;
    }

    const commandName = interaction.data.name;

    console.log(`Processing command: /${commandName}`);

    switch (commandName) {
      case 'draw':
        await handleDraw(interaction);
        break;
      case 'canvas':
        await handleCanvas(interaction);
        break;
      case 'session':
        await handleSession(interaction);
        break;
      case 'snapshot':
        await handleSnapshot(interaction);
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
    console.error('Error processing Discord command:', error);
    throw error; // Trigger retry
  }
});
