const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: 'database-5017698764.ud-webspace.de', // Replace with your database host from united-domains.de
  user: 'dbu349972',                // Replace with your DB-User
  password: 'SitoformDB+25',          // Replace with your DB-Passwort
  database: 'dbs14148917',              // Replace with your database name
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

module.exports = pool;