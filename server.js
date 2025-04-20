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
  host: 'sitoform.com',
  port: 22,
  username: process.env.SFTP_USERNAME,
  password: process.env.SFTP_PASSWORD
};

// Endpoint to upload image and return URL
app.post('/api/upload-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const sftp = new Client();
    await sftp.connect(sftpConfig);

    const fileName = `${Date.now()}-${req.file.originalname}`;
    const remotePath = `/public_html/images/${fileName}`; // Adjust based on your hosting structure
    await sftp.put(req.file.buffer, remotePath);

    await sftp.end();

    const imageUrl = `https://sitoform.com/images/${fileName}`;
    res.json({ imageUrl });
  } catch (error) {
    console.error('Error uploading image:', error);
    res.status(500).json({ error: 'Failed to upload image' });
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