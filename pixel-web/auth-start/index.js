exports.authStart = (req, res) => {
  const clientId = process.env.CLIENT_ID;
  const redirectUri = process.env.REDIRECT_URI;

  const scope = "identify";

  const discordUrl =
    "https://discord.com/api/oauth2/authorize" +
    `?client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    "&response_type=code" +
    `&scope=${scope}`;

  res.redirect(discordUrl);
};
