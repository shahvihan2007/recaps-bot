const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActivityType
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const parser = require('./parser');

// Load config with fallback to environment variables
let DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
let RECAPS_CHANNEL_ID = process.env.RECAPS_CHANNEL_ID;

if (!DISCORD_BOT_TOKEN || !RECAPS_CHANNEL_ID) {
  const configPath = path.join(__dirname, 'config.json');
  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      DISCORD_BOT_TOKEN = DISCORD_BOT_TOKEN || config.DISCORD_BOT_TOKEN;
      RECAPS_CHANNEL_ID = RECAPS_CHANNEL_ID || config.RECAPS_CHANNEL_ID;
    }
  } catch (e) {
    console.error("Could not load config.json:", e.message);
  }
}

if (!DISCORD_BOT_TOKEN || DISCORD_BOT_TOKEN === 'YOUR_BOT_TOKEN_HERE') {
  console.error("Please configure a valid DISCORD_BOT_TOKEN via environment variable or config.json");
  process.exit(1);
}

if (!RECAPS_CHANNEL_ID || RECAPS_CHANNEL_ID === 'YOUR_CHANNEL_ID_HERE') {
  console.error("Please configure a valid RECAPS_CHANNEL_ID via environment variable or config.json");
  process.exit(1);
}

// Initialize SQLite database table
db.setup();

// Initialize Discord Client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages
  ]
});

// Slash commands definition
const commands = [
  {
    name: 'addrecap',
    description: 'Add a new JartexNetwork game recap',
    options: [
      {
        name: 'link',
        description: 'The recap URL (e.g., https://stats.jartexnetwork.com/recap/UUID)',
        type: 3, // String
        required: true
      },
      {
        name: 'tag',
        description: 'The clan/group name (e.g., Ascendancy)',
        type: 3, // String
        required: true
      },
      {
        name: 'comment',
        description: 'Optional comment to add',
        type: 3, // String
        required: false
      }
    ]
  },
  {
    name: 'linkrecaps',
    description: 'Query and list recorded recaps with filters',
    options: [
      {
        name: 'player',
        description: 'Filter by player name',
        type: 3, // String
        required: false
      },
      {
        name: 'tag',
        description: 'Filter by clan/group tag',
        type: 3, // String
        required: false
      },
      {
        name: 'month',
        description: 'Filter by submission month',
        type: 3, // String
        required: false,
        choices: [
          { name: 'January', value: '01' },
          { name: 'February', value: '02' },
          { name: 'March', value: '03' },
          { name: 'April', value: '04' },
          { name: 'May', value: '05' },
          { name: 'June', value: '06' },
          { name: 'July', value: '07' },
          { name: 'August', value: '08' },
          { name: 'September', value: '09' },
          { name: 'October', value: '10' },
          { name: 'November', value: '11' },
          { name: 'December', value: '12' }
        ]
      }
    ]
  },
  {
    name: 'deleterecap',
    description: 'Delete a recap from the database by its tag and recap number',
    options: [
      {
        name: 'tag',
        description: 'The tag associated with the recap (e.g. Ascendancy)',
        type: 3, // String
        required: true
      },
      {
        name: 'recap_number',
        description: 'The recap number (#) to delete',
        type: 4, // Integer
        required: true
      }
    ]
  }
];

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}!`);
  
  // Set simple status activity
  client.user.setPresence({
    activities: [{ name: 'recaps stats', type: ActivityType.Watching }],
    status: 'online'
  });

  // Register commands on startup
  try {
    console.log('Registering global slash commands...');
    await client.application.commands.set(commands);
    console.log('Successfully registered slash commands.');
  } catch (error) {
    console.error('Error registering slash commands:', error);
  }
});

// Handle commands
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  if (commandName === 'addrecap') {
    await handleAddRecap(interaction);
  } else if (commandName === 'linkrecaps') {
    await handleLinkRecaps(interaction);
  } else if (commandName === 'deleterecap') {
    await handleDeleteRecap(interaction);
  }
});

/**
 * Handler for /addrecap command
 */
async function handleAddRecap(interaction) {
  // Ephemeral defer since fetching could take time
  await interaction.deferReply({ ephemeral: true });

  const link = interaction.options.getString('link');
  const tag = interaction.options.getString('tag');
  const comment = interaction.options.getString('comment') || "None";

  // 1. Validate the URL format
  if (!parser.validateUrl(link)) {
    return interaction.editReply({
      content: `❌ Invalid URL format. The URL must be a valid JartexNetwork recap link (e.g., \`https://stats.jartexnetwork.com/recap/UUID\`).`
    });
  }

  try {
    // 2. Fetch and extract details
    const recapData = await parser.fetchRecapData(link);
    
    // 3 & 4. Store recap in database and calculate recap_number
    const result = db.addRecap({
      tag,
      link,
      map: recapData.map,
      duration: recapData.duration,
      mode: recapData.mode,
      winners: recapData.winners,
      players: recapData.players,
      comment: comment,
      uuid: recapData.uuid
    });

    const recapNum = result.recap_number;
    const dateFormatted = new Date(result.timestamp).toUTCString();

    // 5. Post confirmation embed to the dedicated #recaps channel
    let postError = false;
    let recapsChannel = null;

    try {
      recapsChannel = await client.channels.fetch(RECAPS_CHANNEL_ID);
    } catch (e) {
      console.error(`Failed to fetch channel ID ${RECAPS_CHANNEL_ID}:`, e.message);
    }

    if (recapsChannel && recapsChannel.isTextBased()) {
      const confirmationEmbed = new EmbedBuilder()
        .setColor('#2ecc71') // Green border
        .setTitle(`✅ Recap #${recapNum} Added`)
        .addFields(
          { name: '🗺️ Map', value: recapData.map, inline: true },
          { name: '⏱️ Duration', value: recapData.duration, inline: true },
          { name: '🎮 Mode', value: recapData.mode, inline: true },
          { name: '🏷️ Tag', value: tag, inline: true },
          { name: '💬 Comment', value: comment, inline: false },
          { name: '🏆 Winners', value: recapData.winners, inline: false },
          { name: '👥 Players', value: recapData.players, inline: false }
        )
        .setFooter({ text: `UUID: ${recapData.uuid} | ${dateFormatted}` });

      await recapsChannel.send({ embeds: [confirmationEmbed] });
    } else {
      postError = true;
      console.error(`Channel with ID ${RECAPS_CHANNEL_ID} was not found or is not a text channel.`);
    }

    // 6. Ephemeral reply to confirm success
    let successMessage = `✅ Recap #${recapNum} for tag **${tag}** has been successfully added to the database.`;
    if (postError) {
      successMessage += `\n⚠️ Note: Could not post the embed to the designated channel (Channel ID: ${RECAPS_CHANNEL_ID}). Please verify the configuration.`;
    }

    await interaction.editReply({ content: successMessage });

  } catch (error) {
    console.error("Error processing /addrecap:", error);
    await interaction.editReply({
      content: `❌ Error adding recap: ${error.message}`
    });
  }
}

/**
 * Handler for /linkrecaps command
 */
async function handleLinkRecaps(interaction) {
  // Public defer since this is a public command
  await interaction.deferReply();

  const player = interaction.options.getString('player');
  const tag = interaction.options.getString('tag');
  const month = interaction.options.getString('month');

  // Query SQLite with any filters
  const recaps = db.getFilteredRecaps({ player, tag, month });

  // Format header text: 🔗 Links — [tag/player/all] | [N] recap(s) found
  let filterText = 'all';
  if (tag && player) {
    filterText = `${tag} / ${player}`;
  } else if (tag) {
    filterText = tag;
  } else if (player) {
    filterText = player;
  }

  const totalRecaps = recaps.length;
  const headerText = `🔗 Links — ${filterText} | ${totalRecaps} recap(s) found`;

  if (totalRecaps === 0) {
    const emptyEmbed = new EmbedBuilder()
      .setColor('#3498db')
      .setTitle(headerText)
      .setDescription('No recaps matching the selected filters were found.');
    return interaction.editReply({ embeds: [emptyEmbed] });
  }

  const itemsPerPage = 10;
  const totalPages = Math.ceil(totalRecaps / itemsPerPage);
  let currentPage = 1;

  // Function to build embed for a specific page
  const buildPageEmbed = (page) => {
    const startIndex = (page - 1) * itemsPerPage;
    const pageItems = recaps.slice(startIndex, startIndex + itemsPerPage);

    const description = pageItems.map(item => {
      return `Recap #${item.recap_number} — [${item.mode}] — [${item.map}] — [URL](${item.link})`;
    }).join('\n');

    return new EmbedBuilder()
      .setColor('#3498db')
      .setTitle(headerText)
      .setDescription(description)
      .setFooter({ text: `Page ${page} of ${totalPages}` });
  };

  // Function to build action buttons
  const buildPageButtons = (page) => {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('prev_page')
        .setLabel('Previous')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(page === 1),
      new ButtonBuilder()
        .setCustomId('next_page')
        .setLabel('Next')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(page === totalPages)
    );
  };

  const initialEmbed = buildPageEmbed(currentPage);
  const initialRow = buildPageButtons(currentPage);

  const reply = await interaction.editReply({
    embeds: [initialEmbed],
    components: [initialRow]
  });

  // Collect button interactions
  const collector = reply.createMessageComponentCollector({
    filter: i => i.user.id === interaction.user.id,
    time: 60000 // 1 minute session duration
  });

  collector.on('collect', async i => {
    if (i.customId === 'prev_page') {
      currentPage = Math.max(1, currentPage - 1);
    } else if (i.customId === 'next_page') {
      currentPage = Math.min(totalPages, currentPage + 1);
    }

    const updatedEmbed = buildPageEmbed(currentPage);
    const updatedRow = buildPageButtons(currentPage);

    await i.update({
      embeds: [updatedEmbed],
      components: [updatedRow]
    });
  });

  collector.on('end', async () => {
    // Disable all buttons when session expires
    const disabledRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('prev_page')
        .setLabel('Previous')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId('next_page')
        .setLabel('Next')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(true)
    );

    try {
      await interaction.editReply({
        components: [disabledRow]
      });
    } catch (e) {
      // Message might have been deleted, ignore
    }
  });
}

/**
 * Handler for /deleterecap command
 */
async function handleDeleteRecap(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const tag = interaction.options.getString('tag');
  const recapNumber = interaction.options.getInteger('recap_number');

  try {
    const deletedCount = db.deleteRecap({ tag, recap_number: recapNumber });

    if (deletedCount > 0) {
      await interaction.editReply({
        content: `✅ Successfully deleted recap **#${recapNumber}** for tag **${tag}**.`
      });
    } else {
      await interaction.editReply({
        content: `❌ No recap found for tag **${tag}** with recap number **#${recapNumber}**.`
      });
    }
  } catch (error) {
    console.error("Error processing /deleterecap:", error);
    await interaction.editReply({
      content: `❌ Error deleting recap: ${error.message}`
    });
  }
}

// Log in to Discord
client.login(DISCORD_BOT_TOKEN);
