import { shutdown, start } from "./boot.ts";

start().then((running) => {
  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`Arrêt demandé (${signal}), fermeture propre de la base`);
    shutdown(running).then(
      () => process.exit(0),
      (error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
      },
    );
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
}, (error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
