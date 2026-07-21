const { createApp } = require('./src/app');

// Render (and most hosts) inject the port to bind to.
const PORT = process.env.PORT || 3000;

const app = createApp();

app.listen(PORT, () => {
  console.log(`\n  Marketing Lab Tools running on port ${PORT}\n`);
});
