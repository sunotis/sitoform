const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const multer = require('multer');
const Client = require('ssh2-sftp-client');
const { createClient } = require('@supabase/supabase-js');
const app = express();

app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.connect((err, client, release) => {
  if (err) {
    console.error('Error connecting to database:', err.stack);
    process.exit(1);
  } else {
    console.log('Database connection successful');
    release();
  }
});

// Supabase client for verifying JWT
const supabaseUrl = 'https://ydfkrwjafnuvdvezpkcp.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY;
if (!supabaseKey) {
  throw new Error('SUPABASE_KEY environment variable is not set');
}
const supabaseClient = createClient(supabaseUrl, supabaseKey);

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const sftpConfig = {
  host: process.env.SFTP_HOST || 'access-5013295760.ud-webspace.de',
  port: parseInt(process.env.SFTP_PORT) || 22,
  username: process.env.SFTP_USERNAME,
  password: process.env.SFTP_PASSWORD
};

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

    const remoteDir = '/sitoform_com/images';
    try {
      await sftp.mkdir(remoteDir, true);
      console.log(`Directory ${remoteDir} created or already exists`);
    } catch (mkdirError) {
      if (mkdirError.code !== 'EEXIST') {
        throw new Error(`Failed to create directory ${remoteDir}: ${mkdirError.message}`);
      }
    }

    const fileName = `${Date.now()}-${req.file.originalname}`;
    const remotePath = `${remoteDir}/${fileName}`;
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

app.delete('/api/artworks/:id', async (req, res) => {
  const { id } = req.params;
  const token = req.headers.authorization?.split('Bearer ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    // Verify JWT token
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Fetch the artwork to get the imageurl
    const { rows } = await pool.query('SELECT imageurl FROM artworks WHERE id = $1', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Artwork not found' });
    }

    const imageUrl = rows[0].imageurl;

    // Delete the artwork from the database
    const { rowCount } = await pool.query('DELETE FROM artworks WHERE id = $1', [id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Artwork not found' });
    }

    // Optionally, delete the image from the web server
    if (imageUrl) {
      try {
        const sftp = new Client();
        await sftp.connect(sftpConfig);

        // Extract the file path from the imageUrl
        const filePath = imageUrl.replace('https://sitoform.com', '/sitoform_com');
        await sftp.delete(filePath);
        console.log(`Deleted image: ${filePath}`);

        await sftp.end();
      } catch (sftpError) {
        console.error('Error deleting image from SFTP:', sftpError);
        // Continue even if image deletion fails
      }
    }

    res.json({ message: 'Artwork deleted successfully' });
  } catch (error) {
    console.error('Error deleting artwork:', error);
    res.status(500).json({ error: 'Failed to delete artwork' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});