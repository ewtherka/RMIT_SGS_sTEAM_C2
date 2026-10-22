import { createApp } from './app.js';
const { app, config } = await createApp();
await app.listen(config.port, config.host);
console.log(`CareFlow API: ${config.publicUrl}; Swagger: ${config.publicUrl}/docs`);
