import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";

export const commands = [
  new SlashCommandBuilder()
    .setName("rtw_setup")
    .setDescription("Admin: load the RTW route into this server")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
  .setName("rtw_complete")
  .setDescription("Complete your next RTW leg"),
  
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
    .setName("rtw_route")
    .setDescription("Show the full RTW route"),
  
 new SlashCommandBuilder()
  .setName("vatsim_debug")
  .setDescription("Show VATSIM auto-tracking debug info for your linked CID"),  
  
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
    .setName("rtw_check")
    .setDescription("Manual strict checkoff (must match your next leg)")
    .addStringOption(o => o.setName("dep").setRequired(true).setDescription("Departure ICAO"))
    .addStringOption(o => o.setName("arr").setRequired(true).setDescription("Arrival ICAO")),

  new SlashCommandBuilder()
    .setName("rtw_export_db")
    .setDescription("Admin: download the RTW database")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  // VATSIM identity improvements
  new SlashCommandBuilder()
    .setName("vatsim_link")
    .setDescription("Link your VATSIM CID (for auto logging)")
    .addStringOption(o => o.setName("cid").setRequired(true).setDescription("VATSIM CID (numbers only)")),

  new SlashCommandBuilder()
    .setName("vatsim_me")
    .setDescription("Show your linked VATSIM CID"),

  new SlashCommandBuilder()
    .setName("vatsim_unlink")
    .setDescription("Unlink your VATSIM CID from your Discord account"),

  new SlashCommandBuilder()
    .setName("vatsim_pilots")
    .setDescription("Admin: list pilots who linked a VATSIM CID in this server")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

].map(c => c.toJSON());
