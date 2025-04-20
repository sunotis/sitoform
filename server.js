const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const multer = require('multer');
const Client = require('ssh2-sftp-client');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json());

const url = new URL(process.env.DATABASE_URL);
const pool = new Pool({
  user: url.username,
  password: url.password,
  host: url.hostname,
  port: url.port,
  database: url.pathname.split('/')[1],
  ssl: { rejectUnauthorized: false },
  family: 4
});

// Multer setup for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// SFTP configuration for sitoform.com
const sftpConfig = {
  host: 'access-5013295760.ud-webspace.de', // Updated SFTP host
  port: parseInt(process.env.SFTP_PORT) || 22,
  username: process.env.SFTP_USERNAME,
  password: process.env.SFTP_PASSWORD
};

// Endpoint to upload image and return URL
app.post('/api/upload-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    console.log('Attempting SFTP connection with config:', {
      host: sftpConfig.host,
      port: sftpConfig.port,
      username: sftpConfig.username
    });

    const sftp = new Client();
    try {
      await sftp.connect(sftpConfig);
    } catch (connectError) {
      throw new Error(`Failed to connect to SFTP server: ${connectError.message}`);
    }

    const fileName = `${Date.now()}-${req.file.originalname}`;
    const remotePath = `/public_html/images/${fileName}`;
    await sftp.put(req.file.buffer, remotePath);

    await sftp.end();

    const imageUrl = `https://sitoform.com/images/${fileName}`;
    res.json({ imageUrl });
  } catch (error) {
    console.error('Error uploading image:', error);
    res.status(500).json({ error: `Failed to upload image: ${error.message}` });
  }
});

app.get('/api/artworks', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM artworks ORDER BY id ASC');
    res.json(rows);
  } catch (error) {
    console.error('Error fetching artworks:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});