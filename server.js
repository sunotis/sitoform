const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const multer = require('multer');
const Client = require('ssh2-sftp-client');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json());

const pool = new Pool({
  user: process.env.DB_USERNAME || 'postgres.ydfkrwjafnuvdvezpkcp',
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST || 'aws-0-us-east-1.pooler.supabase.com',
  port: parseInt(process.env.DB_PORT) || 6543,
  database: process.env.DB_NAME || 'postgres',
  ssl: { rejectUnauthorized: false },
  family: 4
});

// Multer setup for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// SFTP configuration
const sftpConfig = {
  host: process.env.SFTP_HOST || 'access-5013295760.ud-webspace.de',
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

    // Ensure the /sitoform_com/images directory exists
    const remoteDir = '/sitoform_com/images'; // Updated path
    try {
      await sftp.mkdir(remoteDir, true); // true allows recursive creation
      console.log(`Directory ${remoteDir} created or already exists`);
    } catch (mkdirError) {
      if (mkdirError.code !== 'EEXIST') { // Ignore if directory already exists
        throw new Error(`Failed to create directory ${remoteDir}: ${mkdirError.message}`);
      }
    }

    const fileName = `${Date.now()}-${req.file.originalname}`;
    const remotePath = `${remoteDir}/${fileName}`;
    await sftp.put(req.file.buffer, remotePath);

    await sftp.end();

    const imageUrl = `https://sitoform.com/images/${fileName}`; // Ensure this URL matches the public path
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