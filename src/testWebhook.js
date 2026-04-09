const axios = require('axios');

const webhookUrl = process.env.DISCORD_WEBHOOK || process.env.DISCORD_WEBHOOK;

if (!webhookUrl) {
  console.error('No webhook configured; set DISCORD_WEBHOOK');
  process.exit(1);
}

const embed = {
  title: 'CS2 Monitor — test message',
  description: `Test sent at ${new Date().toISOString()}`,
  timestamp: new Date().toISOString()
};

axios.post(webhookUrl, { embeds: [embed] })
  .then(() => {
    console.log('Test webhook sent');
    process.exit(0);
  })
  .catch(err => {
    console.error('Failed to send test webhook', err.message || err);
    process.exit(2);
  });
