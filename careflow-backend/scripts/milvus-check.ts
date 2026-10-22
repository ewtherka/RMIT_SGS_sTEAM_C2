import { MilvusClient } from '@zilliz/milvus2-sdk-node';
import { loadConfig } from '../src/config.js';
const config = loadConfig();
if (!config.milvusAddress)
  console.log('Milvus disabled: no vector feature in MVP. Scheduling uses SQLite transactions.');
else {
  const client = new MilvusClient({
    address: config.milvusAddress,
    token: config.milvusToken,
    timeout: 5000,
  });
  try {
    const health = await client.checkHealth();
    console.log(
      JSON.stringify({
        healthy: health.isHealthy,
        usage: 'OPTIONAL_VECTOR_STORE_ONLY',
        collectionsCreated: false,
      }),
    );
    if (!health.isHealthy) process.exitCode = 1;
  } catch {
    console.error('Optional Milvus health check failed.');
    process.exitCode = 1;
  } finally {
    await client.closeConnection();
  }
}
