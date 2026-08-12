// server.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const Jimp = require('jimp');

const app = express();
const PORT = process.env.PORT || 3000;

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB Atlas successfully!'))
  .catch(err => console.error('MongoDB connection error:', err));

// Schema Definition
const ImageSchema = new mongoose.Schema({
  originalName: String,
  contentType: String,
  grayscaleBuffer: Buffer,
  asciiText: String,
  createdAt: { type: Date, default: Date.now, expires: 3600 }
});

const ImageModel = mongoose.model('ProcessedImage', ImageSchema);

// Configure Uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }
});

// Helper: Convert to Grayscale Buffer
async function makeGrayscale(buffer) {
  const image = await Jimp.read(buffer);
  return await image.grayscale().getBufferAsync(Jimp.MIME_PNG);
}

// Helper: Convert to ASCII Text String
async function makeAscii(buffer) {
  const image = await Jimp.read(buffer);
  image.resize(60, Jimp.AUTO).grayscale(); // Sized for mobile screens
  
  const chars = '@%#*+=-:. ';
  let asciiStr = '';

  for (let y = 0; y < image.bitmap.height; y++) {
    for (let x = 0; x < image.bitmap.width; x++) {
      const pixelColor = image.getPixelColor(x, y);
      const rgba = Jimp.intToRGBA(pixelColor);
      const brightness = (rgba.r + rgba.g + rgba.b) / 3; 
      const charIndex = Math.floor((brightness / 255) * (chars.length - 1));
      asciiStr += chars[charIndex];
    }
    asciiStr += '\n';
  }
  return asciiStr;
}

// --- FRONTEND USER INTERFACE ROUTE ---
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Image Converter Studio</title>
      <style>
        body { font-family: sans-serif; padding: 20px; background: #f0f2f5; color: #333; max-width: 500px; margin: 0 auto; }
        h1 { text-align: center; color: #1a73e8; font-size: 1.5rem; }
        .card { background: white; padding: 20px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); margin-bottom: 20px; }
        input[type="file"] { width: 100%; margin-bottom: 15px; padding: 10px; border: 1px dashed #ccc; border-radius: 6px; }
        button { width: 100%; background: #1a73e8; color: white; border: none; padding: 12px; border-radius: 6px; font-weight: bold; cursor: pointer; margin-bottom: 10px; font-size: 1rem; }
        button.ascii-btn { background: #34a853; }
        #previewContainer { text-align: center; display: none; margin-top: 15px; }
        #imageViewer { max-width: 100%; max-height: 250px; border-radius: 8px; border: 1px solid #ddd; }
        #asciiViewer { white-space: pre; font-family: monospace; font-size: 8px; letter-spacing: 4px; line-height: 8px; background: black; color: #00ff00; padding: 10px; border-radius: 8px; overflow-x: auto; text-align: left; display: none; max-height: 300px; }
        .links-box { display: none; background: #e8f0fe; padding: 15px; border-radius: 8px; border: 1px solid #1a73e8; margin-top: 15px; }
        .links-box a { display: block; color: #1a73e8; font-weight: bold; margin: 8px 0; text-decoration: none; }
      </style>
    </head>
    <body>

      <h1>📸 Image Studio</h1>
      
      <div class="card">
        <input type="file" id="fileInput" accept="image/*">
        
        <!-- Live Viewer Actions -->
        <button id="grayViewBtn">1. View Grayscale Preview</button>
        <button id="asciiViewBtn" class="ascii-btn">2. View ASCII Art Preview</button>
      </div>

      <!-- Live Preview Area -->
      <div id="previewContainer" class="card">
        <h3>✨ Live Preview Panel</h3>
        <img id="imageViewer" src="" alt="Grayscale Preview" style="display:none;">
        <div id="asciiViewer"></div>
        <button id="saveDbBtn" style="background:#f4b400; margin-top:15px; display:none;">💾 Looks Good! Save to Database</button>
        
        <div id="linksBox" class="links-box">
          <p style="margin-top:0; color:#333;">🎉 Saved to Cloud! Links will auto-delete after downloading:</p>
          <div id="downloadLinks"></div>
        </div>
      </div>

      <script>
        const fileInput = document.getElementById('fileInput');
        const grayViewBtn = document.getElementById('grayViewBtn');
        const asciiViewBtn = document.getElementById('asciiViewBtn');
        const previewContainer = document.getElementById('previewContainer');
        const imageViewer = document.getElementById('imageViewer');
        const asciiViewer = document.getElementById('asciiViewer');
        const saveDbBtn = document.getElementById('saveDbBtn');
        const linksBox = document.getElementById('linksBox');
        const downloadLinks = document.getElementById('downloadLinks');

        let currentMode = '';

        // Reset views helper
        function hideAllViews() {
          previewContainer.style.display = 'block';
          imageViewer.style.display = 'none';
          asciiViewer.style.display = 'none';
          saveDbBtn.style.display = 'none';
          linksBox.style.display = 'none';
        }

        // Action: Generate Grayscale Preview locally in browser
        grayViewBtn.addEventListener('click', () => {
          if (!fileInput.files[0]) return alert('Please pick an image file first!');
          hideAllViews();
          currentMode = 'grayscale';
          
          const reader = new FileReader();
          reader.onload = function(e) {
            imageViewer.src = e.target.result;
            imageViewer.style.filter = 'grayscale(100%)'; // Visual preview using canvas style
            imageViewer.style.display = 'block';
            saveDbBtn.innerText = '💾 Save Grayscale Image to DB';
            saveDbBtn.style.display = 'block';
          }
          reader.readAsDataURL(fileInput.files[0]);
        });

        // Action: Request temporary ASCII rendering string from server
        asciiViewBtn.addEventListener('click', async () => {
          if (!fileInput.files[0]) return alert('Please pick an image file first!');
          hideAllViews();
          currentMode = 'ascii';

          const formData = new FormData();
          formData.append('image', fileInput.files[0]);

          asciiViewer.innerText = 'Generating characters... Please wait...';
          asciiViewer.style.display = 'block';

          try {
            const res = await fetch('/preview-ascii', { method: 'POST', body: formData });
            const data = await res.json();
            if (data.ascii) {
              asciiViewer.innerText = data.ascii;
              saveDbBtn.innerText = '💾 Save ASCII Art to DB';
              saveDbBtn.style.display = 'block';
            } else {
              alert('Error creating text preview.');
            }
          } catch (err) {
            alert('Failed to connect to server.');
          }
        });

        // Action: Finally save confirmed variant to MongoDB
        saveDbBtn.addEventListener('click', async () => {
          const formData = new FormData();
          formData.append('image', fileInput.files[0]);
          formData.append('mode', currentMode);

          saveDbBtn.innerText = 'Uploading to Cloud...';
          saveDbBtn.disabled = true;

          try {
            const res = await fetch('/upload', { method: 'POST', body: formData });
            const result = await res.json();
            
            if (result.downloadUrl) {
              downloadLinks.innerHTML = '<a href="' + result.downloadUrl + '" download>⬇️ Download Your Created File</a>';
              linksBox.style.display = 'block';
              saveDbBtn.style.display = 'none';
            } else {
              alert('Cloud storage failed.');
            }
          } catch (err) {
            alert('Error pushing to database.');
          } finally {
            saveDbBtn.innerText = '💾 Looks Good! Save to Database';
            saveDbBtn.disabled = false;
          }
        });
      </script>
    </body>
    </html>
  `);
});

// --- API PROCESSING ENDPOINTS ---

// Temporary endpoint for ASCII preview layout engine
app.post('/preview-ascii', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Missing file' });
    const asciiText = await makeAscii(req.file.buffer);
    res.json({ ascii: asciiText });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Main database commitment processing node
app.post('/upload', upload.single('image'), async (req, res) => {
  try {
    const { mode } = req.body;
    if (!req.file) return res.status(400).send('No file uploaded.');

    let grayscaleBuffer = null;
    let asciiText = null;

    // Process only what the user requested based on the button clicked
    if (mode === 'grayscale') {
      grayscaleBuffer = await makeGrayscale(req.file.buffer);
    } else if (mode === 'ascii') {
      asciiText = await makeAscii(req.file.buffer);
    }

    const newImage = new ImageModel({
      originalName: req.file.originalname,
      contentType: 'image/png',
      grayscaleBuffer,
      asciiText
    });

    const savedDoc = await newImage.save();
    
    // Provide a direct, specific download link
    const downloadUrl = `${req.protocol}://${req.get('host')}/download/${savedDoc._id}/${mode}`;
    res.json({ downloadUrl });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Single Download Endpoint with Forced Destruction Hook
app.get('/download/:id/:type', async (req, res) => {
  try {
    const { id, type } = req.params;
    const doc = await ImageModel.findById(id);

