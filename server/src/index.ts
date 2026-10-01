import "dotenv/config";
import { app } from "./app.js";
import { failInterruptedImports } from "./routes/imports.js";

const port = process.env.PORT || 3000;

const interrupted = await failInterruptedImports();
if (interrupted > 0) {
  console.log(`Marked ${interrupted} interrupted photo import(s) as failed`);
}

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
