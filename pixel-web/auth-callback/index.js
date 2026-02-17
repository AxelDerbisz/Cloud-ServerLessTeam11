const fetch = require("node-fetch");
const jwt = require("jsonwebtoken");
const { Firestore } = require("@google-cloud/firestore")

const firestore = new Firestore({
  projectId: process.env.PROJECT_ID,
  databaseId: "team11-database"
});

exports.authCallback = async (req, res) => {
  // Here we extract the authorization code sent by Discord
  const code = req.query.code;

  // Here we exchange the code for an access token
  const tokenData = await exchangeCodeForToken(code);

  // Here we fetch the Discord user profile using the access token
  const user = await fetchDiscordUser(tokenData.access_token);

  await saveUserToFirestore(user);

  // Here we create a signed JWT for our application session
  const appToken = createAppToken(user);

  // Here we send the token back to the frontend
  res.json({ token: appToken, user: { id: user.id, username: user.username } });
};

// Here we exchange the OAuth2 code for an access token
async function exchangeCodeForToken(code) {
  const response = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.CLIENT_SECRET,
      grant_type: "authorization_code",
      code: code,
      redirect_uri: process.env.REDIRECT_URI
    })
  });

  return response.json();
}

// Here we retrieve the Discord user profile using the access token
async function fetchDiscordUser(accessToken) {
  const response = await fetch("https://discord.com/api/users/@me", {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  return response.json();
}

async function saveUserToFirestore(user, accessToken) {
  if (!user || !user.id) {
    console.error("User object invalid:", user);
    throw new Error("User ID is missing from Discord response");
  }

  await firestore.collection("users").doc(user.id).set({
    id: user.id,
    username: user.username,
    avatar: user.avatar || null,
    lastLoginAt: new Date().toISOString()
  }, { merge: true });

  console.log("User saved:", user.id);
}

function createAppToken(user) {
  return jwt.sign(
    {
      discordId: user.id,
      username: user.username
    },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
}