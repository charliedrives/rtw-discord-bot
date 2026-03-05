import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";

export const commands = [
  new SlashCommandBuilder()
    .setName("rtw_setup")
    .setDescription("Setup RTW route (server-wide)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("rtw_channel")
    .setDescription("Admin: set the channel where completions are announced")
    .addChannelOption(o =>
      o.setName("channel").setDescription("Announcement channel").setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("rtw_next")
    .setDescription("Show your next leg"),

  new SlashCommandBuilder()
    .setName("rtw_status")
    .setDescription("Show RTW progress (you or another user)")
    .addUserOption(o =>
      o.setName("user").setDescription("Optional: check someone else")
    ),

  new SlashCommandBuilder()
    .setName("rtw_leaderboard")
    .setDescription("Show the RTW leaderboard"),

  new SlashCommandBuilder()
    .setName("rtw_check")
    .setDescription("Manual strict checkoff (must match your next leg)")
    .addStringOption(o => o.setName("dep").setRequired(true).setDescription("Departure ICAO"))
    .addStringOption(o => o.setName("arr").setRequired(true).setDescription("Arrival ICAO")),

  new SlashCommandBuilder()
    .setName("vatsim_link")
    .setDescription("Link your VATSIM CID (for auto logging later)")
    .addStringOption(o => o.setName("cid").setRequired(true).setDescription("VATSIM CID")),
].map(c => c.toJSON());