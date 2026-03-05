
import { Client, GatewayIntentBits } from "discord.js";
import { openDb } from "./db.js";
import { RTW_ROUTE } from "./route.js";
import { startPoller } from "./vatsimPoller.js";

const client = new Client({ intents:[GatewayIntentBits.Guilds] });
const db = openDb();

client.once("ready",()=>{
  console.log("Bot online:", client.user.tag);
  startPoller();
});

client.on("interactionCreate", async interaction=>{
  if(!interaction.isChatInputCommand()) return;

  if(interaction.commandName==="rtw_setup"){
    RTW_ROUTE.forEach((leg,i)=>{
      db.prepare("INSERT OR IGNORE INTO route_legs VALUES(?,?,?,?)")
      .run(interaction.guildId,i+1,leg[0],leg[1]);
    });
    await interaction.reply("RTW route loaded.");
  }

  if(interaction.commandName==="rtw_next"){
    const row=db.prepare(
      "SELECT leg_index,from_icao,to_icao FROM route_legs WHERE guild_id=? ORDER BY leg_index LIMIT 1"
    ).get(interaction.guildId);
    await interaction.reply(`Next leg: ${row.from_icao} → ${row.to_icao}`);
  }

  if(interaction.commandName==="rtw_status"){
    const done=db.prepare(
      "SELECT COUNT(*) c FROM completions WHERE discord_id=?"
    ).get(interaction.user.id).c;
    await interaction.reply(`You completed ${done} legs.`);
  }

  if(interaction.commandName==="rtw_check"){
    const dep=interaction.options.getString("dep").toUpperCase();
    const arr=interaction.options.getString("arr").toUpperCase();

    const leg=db.prepare(
      "SELECT leg_index FROM route_legs WHERE from_icao=? AND to_icao=?"
    ).get(dep,arr);

    if(!leg){
      await interaction.reply("That leg is not part of the RTW route.");
      return;
    }

    db.prepare(
      "INSERT OR IGNORE INTO completions VALUES(?,?,?,datetime('now'))"
    ).run(interaction.guildId,interaction.user.id,leg.leg_index);

    await interaction.reply(`Leg ${leg.leg_index} completed: ${dep} → ${arr}`);
  }

  if(interaction.commandName==="vatsim_link"){
    const cid=interaction.options.getString("cid");
    db.prepare(
      "INSERT OR REPLACE INTO user_links VALUES(?,?,?)"
    ).run(interaction.guildId,interaction.user.id,cid);
    await interaction.reply("VATSIM CID linked.");
  }
});

client.login(process.env.DISCORD_TOKEN);
