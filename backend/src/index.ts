import { app, initApp } from "./app.js";

const PORT = process.env.PORT || 3000;

initApp()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialise app:", err);
    process.exit(1);
  });
