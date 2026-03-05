import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";

export const commands = [
  new SlashCommandBuilder()
    .setName("rtw_setup")
    .setDescription("Admin: load the RTW route into this server")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("rtw_channel")
    .setDescription("Admin: set the channel where leg completions are announced")
    .addChannelOption(o =>
      o.setName("channel").setDescription("Announcement channel").setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("rtw_daily_channel")
    .setDescription("Admin: set the channel for the daily RTW update post")
    .addChannelOption(o =>
      o.setName("channel").setDescription("Daily update channel").setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("rtw_next")
    .setDescription("Show your next RTW leg"),

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
  .setName("rtw_export_db")
  .setDescription("Admin: download the RTW database")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("rtw_check")
    .setDescription("Manual strict checkoff (must match your next leg)")
    .addStringOption(o => o.setName("dep").setRequired(true).setDescription("Departure ICAO"))
    .addStringOption(o => o.setName("arr").setRequired(true).setDescription("Arrival ICAO")),

  new SlashCommandBuilder()
    .setName("vatsim_link")
    .setDescription("Link your VATSIM CID (for future auto logging)")
    .addStringOption(o => o.setName("cid").setRequired(true).setDescription("VATSIM CID")),
].map(c => c.toJSON());
