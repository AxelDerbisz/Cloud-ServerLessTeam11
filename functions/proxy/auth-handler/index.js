const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const { SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { TraceExporter } = require('@google-cloud/opentelemetry-cloud-trace-exporter');
const { Resource } = require('@opentelemetry/resources');
const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');
const { trace, SpanStatusCode } = require('@opentelemetry/api');

const tracerProvider = new NodeTracerProvider({
  resource: new Resource({ [ATTR_SERVICE_NAME]: 'auth-handler' }),
});
tracerProvider.addSpanProcessor(
  new SimpleSpanProcessor(new TraceExporter({ projectId: process.env.PROJECT_ID }))
);
tracerProvider.register();

const tracer = trace.getTracer('auth-handler');

function logJson(severity, message, fields = {}) {
  console.log(JSON.stringify({ severity, message, ...fields }));
}

const functions = require('@google-cloud/functions-framework');
const cookieParser = require("cookie-parser");
const { Firestore, FieldValue } = require('@google-cloud/firestore');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const PROJECT_ID = process.env.PROJECT_ID;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const JWT_SECRET = process.env.JWT_SECRET;

const firestore = new Firestore({
  projectId: PROJECT_ID,
  databaseId: 'team11-database'
});

const DISCORD_API_ENDPOINT = 'https://discord.com/api/v10';


// JWT verification using cookies
function verifyToken(req) {
  try {
    const token = req.cookies?.jwt;
    if (!token) return null;
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}


// Redirect URI
function getRedirectUri(req) {
  if (process.env.REDIRECT_URI) {
    return process.env.REDIRECT_URI;
  }

  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${protocol}://${host}/auth/callback`;
}


// Login
function handleLogin(req, res) {
  const state = crypto.randomBytes(16).toString('hex');
  const redirectUri = getRedirectUri(req);

  logJson('INFO', 'auth_login_redirect', { redirect_uri: redirectUri });

  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify',
    state: state
  });

  const authUrl = `https://discord.com/api/oauth2/authorize?${params.toString()}`;

  res.redirect(authUrl);
}


// Callback
async function handleCallback(req, res) {
  const { code } = req.query;

  if (!code) {
    return res.status(400).json({ error: 'Missing authorization code' });
  }

  try {
    const redirectUri = getRedirectUri(req);

    const tokenResponse = await fetch(`${DISCORD_API_ENDPOINT}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri
      })
    });

    if (!tokenResponse.ok) {
      throw new Error('Failed to exchange code');
    }

    const tokenData = await tokenResponse.json();

    const userResponse = await fetch(`${DISCORD_API_ENDPOINT}/users/@me`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });

    if (!userResponse.ok) {
      throw new Error('Failed to get user info');
    }

    const userData = await userResponse.json();

    // Save user
    await firestore.collection('users').doc(userData.id).set({
      username: userData.username,
      discriminator: userData.discriminator,
      avatar: userData.avatar,
      lastLogin: new Date().toISOString(),
      pixelCount: FieldValue.increment(0)
    }, { merge: true });

    // Create JWT
    const jwtToken = jwt.sign(
      {
        sub: userData.id,
        username: userData.username,
        discriminator: userData.discriminator,
        exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60)
      },
      JWT_SECRET
    );

    // Secure cookie
    res.cookie("jwt", jwtToken, {
      httpOnly: true,
      secure: true,
      sameSite: "None",
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    // Redirect to frontend
    res.redirect(`${process.env.FRONTEND_URL}/canvas`);

  } catch (error) {
    logJson('ERROR', 'auth_callback_failed', { error: error.message });
    res.status(500).json({ error: 'Authentication failed' });
  }
}


// GET current user
async function handleMe(req, res) {
  const user = verifyToken(req);

  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const userDoc = await firestore.collection('users').doc(user.sub).get();

  if (!userDoc.exists) {
    return res.status(404).json({ error: 'User not found' });
  }

  const data = userDoc.data();

  res.status(200).json({
    id: user.sub,
    username: user.username,
    discriminator: user.discriminator,
    pixelCount: data.pixelCount || 0,
    lastPixelAt: data.lastPixelAt || null
  });
}


// Main handler
functions.http('handler', async (req, res) => {
  cookieParser()(req, res, async () => {

    const span = tracer.startSpan('auth-handler');

    try {
      res.set("Access-Control-Allow-Origin", process.env.FRONTEND_URL);
      res.set("Access-Control-Allow-Credentials", "true");
      res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");

      if (req.method === 'OPTIONS') {
        return res.status(204).send('');
      }

      const path = req.path || '/';

      if (path.startsWith('/auth/login')) {
        return handleLogin(req, res);
      }

      if (path.startsWith('/auth/callback')) {
        return await handleCallback(req, res);
      }

      if (path.startsWith('/auth/me')) {
        return await handleMe(req, res);
      }

      res.status(404).json({ error: 'Not found' });

    } catch (error) {
      span.recordException(error);
      res.status(500).json({ error: 'Internal server error' });
    } finally {
      span.end();
      await tracerProvider.forceFlush();
    }
  });
});
