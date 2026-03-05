import { Client, GatewayIntentBits } from "discord.js";
import { openDb } from "./db.js";
import { RTW_ROUTE } from "./route.js";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const db = openDb();

function ensureGuildRow(guildId) {
  db.prepare(`
    INSERT INTO guild_settings (guild_id, announce_channel_id)
    VALUES (?, NULL)
    ON CONFLICT(guild_id) DO NOTHING
  `).run(guildId);
}

function getAnnounceChannelId(guildId) {
  return db.prepare(`SELECT announce_channel_id FROM guild_settings WHERE guild_id=?`)
    .get(guildId)?.announce_channel_id || null;
}

function getNextLeg(guildId, discordId) {
  return db.prepare(`
    SELECT rl.leg_index, rl.from_icao, rl.to_icao
    FROM route_legs rl
    WHERE rl.guild_id = ?
      AND NOT EXISTS (
        SELECT 1
        FROM completions c
        WHERE c.guild_id = rl.guild_id
        AND c.discord_id = ?
        AND c.leg_index = rl.leg_index
      )
    ORDER BY rl.leg_index ASC
    LIMIT 1
  `).get(guildId, discordId);
}

async function announceCompletion({ guildId, discordId, legIndex, dep, arr }) {

  const channelId = getAnnounceChannelId(guildId);
  if (!channelId) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  await channel.send(
    `✅ <@${discordId}> completed **Leg ${legIndex}**: **${dep} → ${arr}**`
  );
}

client.once("ready", () => {
  console.log(`Bot online: ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {

  if (!interaction.isChatInputCommand()) return;

  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  ensureGuildRow(guildId);

  try {

    if (interaction.commandName === "rtw_setup") {

      await interaction.deferReply({ ephemeral: true });

      RTW_ROUTE.forEach((leg, i) => {
        db.prepare(`
          INSERT OR IGNORE INTO route_legs
          (guild_id, leg_index, from_icao, to_icao)
          VALUES (?,?,?,?)
        `).run(guildId, i + 1, leg[0], leg[1]);
      });

      await interaction.editReply("✅ RTW route loaded.");

      return;
    }

    if (interaction.commandName === "rtw_channel") {

      const channel = interaction.options.getChannel("channel");

      db.prepare(`
        UPDATE guild_settings
        SET announce_channel_id=?
        WHERE guild_id=?
      `).run(channel.id, guildId);

      await interaction.reply(`✅ Announcements will post in ${channel}`);

      return;
    }

    if (interaction.commandName === "rtw_next") {

      const next = getNextLeg(guildId, userId);

      if (!next) {
        await interaction.reply("🏁 You’ve completed all legs!");
        return;
      }

      await interaction.reply(
        `Next leg (**${next.leg_index}**): **${next.from_icao} → ${next.to_icao}**`
      );

      return;
    }

    if (interaction.commandName === "rtw_status") {

      await interaction.deferReply();

      const target = interaction.options.getUser("user") || interaction.user;

      const total = db.prepare(`
        SELECT COUNT(*) AS c
        FROM route_legs
        WHERE guild_id=?
      `).get(guildId).c;

      const done = db.prepare(`
        SELECT COUNT(*) AS c
        FROM completions
        WHERE guild_id=? AND discord_id=?
      `).get(guildId, target.id).c;

      const next = getNextLeg(guildId, target.id);

      const nextText = next
        ? `Leg ${next.leg_index}: ${next.from_icao} → ${next.to_icao}`
        : "All done 🏁";

      await interaction.editReply(
        `**${target.username}** — **${done}/${total}** legs\nNext: **${nextText}**`
      );

      return;
    }

    if (interaction.commandName === "rtw_leaderboard") {

      await interaction.deferReply();

      const total = db.prepare(`
        SELECT COUNT(*) AS c
        FROM route_legs
        WHERE guild_id=?
      `).get(guildId).c;

      const rows = db.prepare(`
        SELECT discord_id, COUNT(*) AS completed
        FROM completions
        WHERE guild_id=?
        GROUP BY discord_id
        ORDER BY completed DESC
        LIMIT 10
      `).all(guildId);

      if (!rows.length) {
        await interaction.editReply("No completions yet.");
        return;
      }

      const lines = rows.map((r, i) =>
        `${i + 1}. <@${r.discord_id}> — **${r.completed}/${total}**`
      );

      await interaction.editReply(
        `🏆 **RTW Leaderboard**\n${lines.join("\n")}`
      );

      return;
    }

    if (interaction.commandName === "rtw_check") {

      const dep = interaction.options.getString("dep").toUpperCase();
      const arr = interaction.options.getString("arr").toUpperCase();

      const next = getNextLeg(guildId, userId);

      if (!next) {
        await interaction.reply("🏁 You’ve completed the full route!");
        return;
      }

      if (dep !== next.from_icao || arr !== next.to_icao) {

        await interaction.reply({
          content: `❌ That is not your next leg.\nYour next leg is **${next.from_icao} → ${next.to_icao}**`,
          ephemeral: true
        });

        return;
      }

      db.prepare(`
        INSERT OR IGNORE INTO completions
        (guild_id, discord_id, leg_index, completed_at, source, dep, arr)
        VALUES (?,?,?,datetime('now'),'manual',?,?)
      `).run(guildId, userId, next.leg_index, dep, arr);

      await interaction.reply(
        `✅ Completed **Leg ${next.leg_index}**: **${dep} → ${arr}**`
      );

      await announceCompletion({
        guildId,
        discordId: userId,
        legIndex: next.leg_index,
        dep,
        arr
      });

      return;
    }

    if (interaction.commandName === "vatsim_link") {

      const cid = interaction.options.getString("cid");

      db.prepare(`
        INSERT OR REPLACE INTO user_links
        (guild_id, discord_id, vatsim_cid)
        VALUES (?,?,?)
      `).run(guildId, userId, cid);

      await interaction.reply({
        content: `✅ VATSIM CID linked: **${cid}**`,
        ephemeral: true
      });

      return;
    }

  } catch (err) {

    console.error(err);

    if (!interaction.replied) {
      await interaction.reply({
        content: "Something went wrong.",
        ephemeral: true
      });
    }
  }

});

client.login(process.env.DISCORD_TOKEN);