require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const session = require('express-session');
const cors = require('cors');
const fetch = require('node-fetch');
const { Client, GatewayIntentBits } = require('discord.js');

const app = express();
const PORT = process.env.PORT || 3000;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:8080';

app.use(cors({
  origin: CLIENT_URL,
  credentials: true,
}));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change_me_session_secret',
    resave: false,
    saveUninitialized: false,
  })
);

app.use(express.json());

// Discord bot client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

client.once('ready', () => {
  console.log(`Discord bot logged in as ${client.user.tag}`);
});

client.login(process.env.DISCORD_BOT_TOKEN).catch((err) => {
  console.error('Failed to login Discord bot:', err);
});

// Helper: exchange code for token
async function exchangeCodeForToken(code) {
  const params = new URLSearchParams();
  params.append('client_id', process.env.DISCORD_CLIENT_ID);
  params.append('client_secret', process.env.DISCORD_CLIENT_SECRET);
  params.append('grant_type', 'authorization_code');
  params.append('code', code);
  params.append('redirect_uri', process.env.DISCORD_REDIRECT_URI);

  const res = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });

  if (!res.ok) {
    throw new Error(`Token exchange failed: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

// Helper: fetch current user
async function fetchCurrentUser(accessToken) {
  const res = await fetch('https://discord.com/api/users/@me', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Fetch user failed: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

// OAuth2 callback
app.get('/auth/discord/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.status(400).send('Missing code');
  }

  try {
    const tokenData = await exchangeCodeForToken(code);
    const user = await fetchCurrentUser(tokenData.access_token);

    req.session.userId = user.id;

    return res.redirect(`${CLIENT_URL}/?loggedIn=true`);
  } catch (err) {
    console.error('OAuth callback error:', err);
    return res.status(500).send('OAuth failed');
  }
});

// Status endpoint: check if user is logged in and in guild (server)
app.get('/api/status', async (req, res) => {
  const userId = req.session.userId;
  if (!userId) {
    return res.json({ loggedIn: false, inServer: false });
  }

  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId) {
    return res.status(500).json({ error: 'DISCORD_GUILD_ID not configured' });
  }

  try {
    const guild = await client.guilds.fetch(guildId);
    const member = await guild.members.fetch(userId).catch(() => null);

    const inServer = !!member;

    return res.json({ loggedIn: true, inServer });
  } catch (err) {
    console.error('Status check error:', err);
    return res.status(500).json({ error: 'Failed to check membership' });
  }
});

app.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`);
});
