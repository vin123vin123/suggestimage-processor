// server.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const sharp = require('sharp');
const savedDoc = await newImage.save();


const app = express();
const PORT = process.env.PORT || 3000;

// 1. Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB Atlas'))
  .catch(err => console.error('MongoDB connection error:', err));

// 2. Define Database Schema
const ImageSchema = new mongoose.Schema({
  originalName: String,
  contentType: String,
  grayscaleBuffer: Buffer,
  asciiText: String,
  createdAt: { type: Date, default: Date.now, expires: 3600 } // Auto-delete after 1 hour if never downloaded
});

const ImageModel = mongoose.model('ProcessedImage', ImageSchema);

// 3. Configure Multer for In-Memory File Uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 } // Limit: 5MB
});

// Helper function to turn pixels into ASCII characters
async function convertToAscii(buffer) {
  // Resize image down so the text file isn't massive
  const { data, info } = await sharp(buffer)
    .resize(80, 40, { fit: 'inside' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const chars = '@%#*+=-:. '; // Darkest to lightest
  let asciiStr = '';

  for (let i = 0; i < data.length; i++) {
    const brightness = data[i];
    const charIndex = Math.floor((brightness / 255) * (chars.length - 1));
    asciiStr += chars[charIndex];
    
    // Add a newline at the end of each pixel row
    if ((i + 1) % info.width === 0) {
      asciiStr += '\n';
    }
  }
  return asciiStr;
}

// --- API ENDPOINTS ---

// Home route with simple HTML Forms for testing
app.get('/', (req, res) => {
  res.send(`
    <h1>Image to Grayscale & ASCII Converter</h1>
    <form action="/upload" method="post" enctype="multipart/form-data">
      <input type="file" name="image" required />
      <button type="submit">Upload & Process</button>
    </form>
  `);
});

// Route: Upload and Process Image
app.post('/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).send('No file uploaded.');

    // Process image to Grayscale Buffer
    const grayscaleBuffer = await sharp(req.file.buffer).grayscale().toBuffer();

    // Process image to ASCII text string
    const asciiText = await convertToAscii(req.file.buffer);

    // Save metadata and files directly into MongoDB
    const newImage = new ImageModel({
      originalName: req.file.originalname,
      contentType: req.file.mimetype,
      grayscaleBuffer,
      asciiText
    });

    const savedDoc = await model.save() ? await newImage.save() : newImage;
    
    // Provide links to download and automatically delete the records
    res.json({
      message: 'Processing complete!',
      downloadGrayscaleUrl: `${req.protocol}://${req.get('host')}/download/${savedDoc._id}/grayscale`,
      downloadAsciiUrl: `${req.protocol}://${req.get('host')}/download/${savedDoc._id}/ascii`
    });

  } catch (error) {
    console.error(error);
    res.status(500).send('Error processing image.');
  }
});

// Route: Download File and IMMEDIATELY Delete from Database
app.get('/download/:id/:type', async (req, res) => {
  try {
    const { id, type } = req.params;
    const doc = await ImageModel.findById(id);

    if (!doc) {
      return res.status(404).send('File not found or already downloaded/expired.');
    }

    if (type === 'grayscale') {
      res.setHeader('Content-Type', doc.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="grayscale-${doc.originalName}"`);
      res.send(doc.grayscaleBuffer);
    } else if (type === 'ascii') {
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', `attachment; filename="ascii-${doc.originalName}.txt"`);
      res.send(doc.asciiText);
    } else {
      return res.status(400).send('Invalid download type.');
    }

    // Crucial Step: Delete from MongoDB immediately after transmission
    await ImageModel.findByIdAndDelete(id);
    console.log(`Document ${id} successfully delivered and deleted.`);

  } catch (error) {
    console.error(error);
    res.status(500).send('Error downloading file.');
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
