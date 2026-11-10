const db = require('../database');

db.ready
  .then(async () => {
    console.log(`Database ${db.engine} siap.`);
    await db.close();
  })
  .catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
