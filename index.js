// Required modules
require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { createCanvas, loadImage, registerFont } = require('canvas');

// Register font (you must place a .ttf font in fonts/ folder)
registerFont(path.resolve(__dirname, 'fonts/OpenSans-Bold.ttf'), { family: 'OpenSans' });

const app = express();
app.set("view engine","ejs");
app.set("views",path.join(__dirname,"/views"));
app.get("/",(req,res)=>{
  res.render("home.ejs");
})

// Configure upload directory
const uploadDir = path.resolve(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + unique + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const HF_API_URL = "https://api-inference.huggingface.co/models/facebook/detr-resnet-50";
const HF_API_KEY = process.env.HUGGINGFACE_API_KEY;

const wasteTypeMapping = {
  'banana': 'biodegradable', 'apple': 'biodegradable', 'sandwich': 'biodegradable',
  'orange': 'biodegradable', 'broccoli': 'biodegradable', 'carrot': 'biodegradable',
  'pizza': 'biodegradable', 'donut': 'biodegradable', 'cake': 'biodegradable',
  'hot dog': 'biodegradable', 'dining table': 'biodegradable',
  'bottle': 'non-biodegradable', 'wine glass': 'non-biodegradable', 'cup': 'non-biodegradable',
  'fork': 'non-biodegradable', 'knife': 'non-biodegradable', 'spoon': 'non-biodegradable',
  'bowl': 'non-biodegradable', 'scissors': 'non-biodegradable', 'cell phone': 'non-biodegradable',
  'laptop': 'non-biodegradable', 'mouse': 'non-biodegradable', 'keyboard': 'non-biodegradable',
  'tv': 'non-biodegradable', 'remote': 'non-biodegradable', 'microwave': 'non-biodegradable',
  'toaster': 'non-biodegradable', 'refrigerator': 'non-biodegradable', 'book': 'biodegradable',
  'clock': 'non-biodegradable', 'vase': 'non-biodegradable', 'teddy bear': 'non-biodegradable',
  'hair drier': 'non-biodegradable', 'toothbrush': 'non-biodegradable',"chips packet": "non-biodegradable", 
  "face mask": "non-biodegradable","plastic straw": "non-biodegradable","tin can": "non-biodegradable","aluminum foil": "non-biodegradable",
  "shampoo bottle": "non-biodegradable","detergent bottle": "non-biodegradable","plastic toy": "non-biodegradable",
  "cd": "non-biodegradable","battery": "non-biodegradable","egg shell": "biodegradable",
  "tea bag": "biodegradable","coffee grounds": "biodegradable","vegetable peel": "biodegradable","fruit peel": "biodegradable",
  "bread": "biodegradable", "tissue paper": "biodegradable","flowers": "biodegradable","leaf": "biodegradable",
"paper": "biodegradable"

};

async function analyzeImage(imagePath) {
  const imageBuffer = fs.readFileSync(imagePath);
  const response = await axios.post(HF_API_URL, imageBuffer, {
    headers: {
      Authorization: `Bearer ${HF_API_KEY}`,
      'Content-Type': 'image/jpeg'
    },
    timeout: 30000
  });

  if (response.data.error && response.data.error.includes('loading')) {
    await new Promise(r => setTimeout(r, 20000));
    return analyzeImage(imagePath);
  }

  const image = await loadImage(imagePath);
  const { width, height } = image;

  return response.data.filter(d => d.score > 0.5).map(d => {
    const box = d.box;
    const [xmin, ymin, xmax, ymax] = Array.isArray(box)
      ? box
      : [box.xmin, box.ymin, box.xmax, box.ymax];
    return {
      name: d.label,
      type: wasteTypeMapping[d.label.toLowerCase()] || 'non-biodegradable',
      confidence: d.score,
      box: [xmin / width * 100, ymin / height * 100, (xmax - xmin) / width * 100, (ymax - ymin) / height * 100]
    };
  });
}

async function annotateImageCanvas(imagePath, annotations) {
  const image = await loadImage(imagePath);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');

  ctx.drawImage(image, 0, 0);
  ctx.font = '20px OpenSans';

  annotations.forEach(ann => {
    const [xPct, yPct, wPct, hPct] = ann.box;
    const x = (xPct / 100) * image.width;
    const y = (yPct / 100) * image.height;
    const w = (wPct / 100) * image.width;
    const h = (hPct / 100) * image.height;

    ctx.strokeStyle = ann.type === 'biodegradable' ? 'green' : 'red';
    ctx.lineWidth = 5;
    ctx.strokeRect(x, y, w, h);

    const label = `${ann.name} (${ann.type}) ${(ann.confidence * 100).toFixed(1)}%`;
    const textWidth = ctx.measureText(label).width;
    ctx.fillStyle = 'white';
    ctx.fillRect(x, y - 28, textWidth + 10, 24);

    ctx.fillStyle = 'black';
    ctx.fillText(label, x + 5, y - 10);
  });

  const outputPath = path.join(uploadDir, 'annotated_' + path.basename(imagePath));
  const out = fs.createWriteStream(outputPath);
  const stream = canvas.createJPEGStream();
  stream.pipe(out);

  return new Promise((resolve, reject) => {
    out.on('finish', () => resolve(outputPath));
    out.on('error', reject);
  });
}

function cleanFiles(...paths) {
  paths.forEach(p => fs.existsSync(p) && fs.unlinkSync(p));
}
app.use('/uploads', express.static(uploadDir));

app.post('/upload', (req, res) => {
  upload.single('image')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    const originalPath = req.file?.path;
    if (!originalPath) return res.status(400).json({ error: 'No file uploaded' });

    try {
      const annotations = await analyzeImage(originalPath);
      if (!annotations.length) {
        cleanFiles(originalPath);
        return res.status(200).send('<h2>No objects found</h2>');
      }

      const annotatedPath = await annotateImageCanvas(originalPath, annotations);
      const annotatedFilename = path.basename(annotatedPath);

      // Don't delete immediately so browser can fetch it
      res.render('result.ejs', {
        imageUrl: `/uploads/${annotatedFilename}`,
        detections: annotations
      });

    } catch (error) {
      cleanFiles(originalPath);
      res.status(500).json({ error: error.message });
    }
  });
});


app.post('/analyze', (req, res) => {
  upload.single('image')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    const originalPath = req.file?.path;
    if (!originalPath) return res.status(400).json({ error: 'No file uploaded' });

    try {
      const annotations = await analyzeImage(originalPath);
      cleanFiles(originalPath);
      res.json({ detections: annotations });
    } catch (error) {
      cleanFiles(originalPath);
      res.status(500).json({ error: error.message });
    }
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK', model: 'facebook/detr-resnet-50', apiKeySet: !!HF_API_KEY });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
