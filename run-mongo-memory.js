import { MongoMemoryReplSet } from 'mongodb-memory-server';

async function start() {
  const replSet = await MongoMemoryReplSet.create({
    instanceOpts: [
      {
        port: 27017,
        dbName: 'keystone',
        launchTimeout: 60000,
      },
    ],
    replSet: {
      name: 'rs0',
      count: 1,
    },
  });
  console.log('InMemory Mongo ReplicaSet is running on port 27017!');
  console.log('URI:', replSet.getUri());
}

start().catch((err) => {
  console.error('Failed to start in-memory mongo replicaset:', err);
});
