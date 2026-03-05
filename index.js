import { Client, GatewayIntentBits } from "discord.js";
import { openDb } from "./db.js";
import { RTW_ROUTE } from "./route.js";
import { startPoller } from "./vatsimPoller.js";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const db = openDb();

function getNextLeg(guildId, discordId) {
  // Next leg is the first route_legs row that does NOT have a completion for this user in this guild
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

client.once("ready", () => {
  console.log("Bot online:", client.user.tag);
  startPoller(); // (still just a basic poller in your current build)
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  if (!guildId) {
    await interaction.reply({ content: "Use this command in a server.", ephemeral: true });
    return;
  }

  if (interaction.commandName === "rtw_setup") {
    // Load route (idempotent)
    RTW_ROUTE.forEach((leg, i) => {
      db.prepare("INSERT OR IGNORE INTO route_legs (guild_id, leg_index, from_icao, to_icao) VALUES (?,?,?,?)")
        .run(guildId, i + 1, leg[0], leg[1]);
    });
    await interaction.reply("✅ RTW route loaded.");
    return;
  }

  if (interaction.commandName === "rtw_next") {
    const next = getNextLeg(guildId, userId);
    if (!next) {
      await interaction.reply("🏁 You’ve completed all legs!");
      return;
    }
    await interaction.reply(`Next leg (**${next.leg_index}**): **${next.from_icao} → ${next.to_icao}**`);
    return;
  }

  if (interaction.commandName === "rtw_status") {
    const total = db.prepare(
      "SELECT COUNT(*) AS c FROM route_legs WHERE guild_id=?"
    ).get(guildId).c;

    const done = db.prepare(
      "SELECT COUNT(*) AS c FROM completions WHERE guild_id=? AND discord_id=?"
    ).get(guildId, userId).c;

    const next = getNextLeg(guildId, userId);
    const nextStr = next ? `Leg ${next.leg_index}: ${next.from_icao} → ${next.to_icao}` : "All done 🏁";

    await interaction.reply(`Progress: **${done}/${total}** legs.\nNext: **${nextStr}**`);
    return;
  }

  if (interaction.commandName === "rtw_check") {
    const dep = interaction.options.getString("dep", true).toUpperCase().trim();
    const arr = interaction.options.getString("arr", true).toUpperCase().trim();

    const next = getNextLeg(guildId, userId);
    if (!next) {
      await interaction.reply({ content: "🏁 You’ve already completed the full route!", ephemeral: true });
      return;
    }

    // STRICT + ONE DIRECTION ONLY
    if (dep !== next.from_icao || arr !== next.to_icao) {
      await interaction.reply({
        content: `❌ Not your next leg.\nYour next leg is **${next.leg_index}: ${next.from_icao} → ${next.to_icao}**`,
        ephemeral: true
      });
      return;
    }

    db.prepare(
      "INSERT OR IGNORE INTO completions (guild_id, discord_id, leg_index, completed_at) VALUES (?,?,?,datetime('now'))"
    ).run(guildId, userId, next.leg_index);

    await interaction.reply(`✅ Completed **Leg ${next.leg_index}**: **${dep} → ${arr}**`);
    return;
  }

  if (interaction.commandName === "vatsim_link") {
    const cid = interaction.options.getString("cid", true).trim();
    db.prepare("INSERT OR REPLACE INTO user_links (guild_id, discord_id, vatsim_cid) VALUES (?,?,?)")
      .run(guildId, userId, cid);
    await interaction.reply({ content: `✅ VATSIM CID linked: **${cid}**`, ephemeral: true });
    return;
  }
});

client.login(process.env.DISCORD_TOKEN);