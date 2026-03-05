
import { SlashCommandBuilder } from "discord.js";

export const commands = [
new SlashCommandBuilder().setName("rtw_setup").setDescription("Setup RTW route"),
new SlashCommandBuilder().setName("rtw_next").setDescription("Show next leg"),
new SlashCommandBuilder().setName("rtw_status").setDescription("Show progress"),
new SlashCommandBuilder()
  .setName("rtw_check")
  .setDescription("Manual check leg")
  .addStringOption(o=>o.setName("dep").setRequired(true).setDescription("Departure ICAO"))
  .addStringOption(o=>o.setName("arr").setRequired(true).setDescription("Arrival ICAO")),
new SlashCommandBuilder()
  .setName("vatsim_link")
  .setDescription("Link your VATSIM CID")
  .addStringOption(o=>o.setName("cid").setRequired(true).setDescription("VATSIM CID"))
].map(c=>c.toJSON());
