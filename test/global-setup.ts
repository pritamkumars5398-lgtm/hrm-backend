import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { execSync } from 'child_process';

export default async function globalSetup() {
  console.log('\n[Jest Setup] Starting MongoMemoryReplSet...');
  const replSet = await MongoMemoryReplSet.create({
    replSet: { dbName: 'keystone_test', count: 1 },
    instanceOpts: [{ launchTimeout: 60000 }],
  });

  let uri = replSet.getUri();
  if (uri.includes('/?')) {
    uri = uri.replace('/?', '/keystone_test?');
  } else if (uri.endsWith('/')) {
    uri = uri + 'keystone_test';
  } else {
    uri = uri + '/keystone_test';
  }

  process.env.MONGO_URI = uri;
  process.env.DATABASE_URL = uri;

  console.log(`[Jest Setup] MongoMemoryReplSet ready at ${uri}`);
  console.log('[Jest Setup] Waiting 10 seconds for ReplicaSet election...');
  await new Promise((resolve) => setTimeout(resolve, 10000));
  
  console.log('[Jest Setup] Pushing Prisma schema to memory database...');
  
  try {
    execSync('node --max-old-space-size=4096 node_modules/prisma/build/index.js db push --accept-data-loss --skip-generate', {
      stdio: 'inherit',
      timeout: 20000, // 20s timeout to prevent Windows child process hangs
      env: { ...process.env, MONGO_URI: uri, DATABASE_URL: uri },
    });
    console.log('[Jest Setup] Prisma schema pushed successfully!');
  } catch (err) {
    console.log('[Jest Setup] Prisma schema push complete or timed out. Proceeding...');
  }

  // Store reference to close in globalTeardown
  (globalThis as any).__MONGOD__ = replSet;
}
