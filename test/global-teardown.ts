export default async function globalTeardown() {
  console.log('\n[Jest Teardown] Stopping MongoMemoryServer...');
  const mongod = (globalThis as any).__MONGOD__;
  if (mongod) {
    await mongod.stop();
    console.log('[Jest Teardown] MongoMemoryServer stopped!');
  }
}
