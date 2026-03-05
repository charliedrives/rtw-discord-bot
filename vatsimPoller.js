
import cron from "node-cron";

export function startPoller() {
  cron.schedule("*/1 * * * *", async () => {
    try {
      const res = await fetch("https://data.vatsim.net/v3/vatsim-data.json");
      const data = await res.json();
      console.log("VATSIM pilots online:", data.pilots.length);
    } catch(e) {
      console.log("VATSIM poll error", e);
    }
  });
}
