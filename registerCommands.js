
import { REST, Routes } from "discord.js";
import { commands } from "./commands.js";

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

const rest = new REST({ version: "10" }).setToken(token);

await rest.put(Routes.applicationCommands(clientId), { body: commands });
console.log("Commands registered");
