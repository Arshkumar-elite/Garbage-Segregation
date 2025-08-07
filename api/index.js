// Required modules
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { createCanvas, loadImage, registerFont } = require('canvas');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);


// Register font (you must place a .ttf font in fonts/ folder)
registerFont(path.resolve(__dirname, '../fonts/OpenSans-Bold.ttf'), { family: 'OpenSans' });

const app = express();
app.use(express.static(path.join(__dirname, '../public/assets')));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "../views"));
app.get("/", (req, res) => {
    res.render("home.ejs");
});


// Configure upload directory
const uploadDir = path.join('/tmp', 'uploads');
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

const HF_API_URL = "https://api-inference.huggingface.co/models/facebook/detr-resnet-101";
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
    'hair drier': 'non-biodegradable', 'toothbrush': 'non-biodegradable', "chips packet": "non-biodegradable",
    "face mask": "non-biodegradable", "plastic straw": "non-biodegradable", "tin can": "non-biodegradable", "aluminum foil": "non-biodegradable",
    "shampoo bottle": "non-biodegradable", "detergent bottle": "non-biodegradable", "plastic toy": "non-biodegradable",
    "cd": "non-biodegradable", "battery": "non-biodegradable", "egg shell": "biodegradable",
    "tea bag": "biodegradable", "coffee grounds": "biodegradable", "vegetable peel": "biodegradable", "fruit peel": "biodegradable",
    "bread": "biodegradable", "tissue paper": "biodegradable", "flowers": "biodegradable", "leaf": "biodegradable",
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
    console.log("got the response??")
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
        const rawType = wasteTypeMapping[d.label.toLowerCase()] || 'non-biodegradable';
        const type = rawType.charAt(0).toUpperCase() + rawType.slice(1);

        return {
            name: d.label,
            type,
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

    return canvas.toBuffer('image/jpeg');  // Return buffer for direct upload to Supabase
}

function cleanFiles(...paths) {
    paths.forEach(p => fs.existsSync(p) && fs.unlinkSync(p));
}
app.use('/uploads', express.static(uploadDir));

app.post('/upload', (req, res) => {
    console.log("yaha hu")
    upload.single('image')(req, res, async (err) => {
        // Handle Multer errors (e.g., file size > 10 MB)
        if (err) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ error: 'The uploaded file exceeds the 10 MB limit. Please try a smaller file.' });
            }
            return res.status(400).json({ error: err.message });
        }
        const originalPath = req.file?.path;
        if (!originalPath) return res.status(400).json({ error: 'No file uploaded' });

        console.log(originalPath)
        try {
            const annotations = await analyzeImage(originalPath);
            if (!annotations.length) {
                cleanFiles(originalPath);
                return res.status(200).send('<h2>No objects found</h2>');
            }

            const annotatedBuffer = await annotateImageCanvas(originalPath, annotations);
            const uniqueFilename = `annotated_${Date.now()}.jpg`;

            // Upload to Supabase Storage
            const { error: uploadError } = await supabase.storage
                .from('annotated-images')
                .upload(uniqueFilename, annotatedBuffer, { contentType: 'image/jpeg' });
            if (uploadError) throw uploadError;

            // Get public URL (reverted from signed URL)
            const { data: urlData } = supabase.storage
                .from('annotated-images')
                .getPublicUrl(uniqueFilename);
            const imageUrl = urlData.publicUrl;

            // Store metadata in DB
            const { data: metadata, error: insertError } = await supabase
                .from('image_metadata')
                .insert({ filename: uniqueFilename })
                .select('id')
                .single();
            if (insertError) throw insertError;

            cleanFiles(originalPath);  // Clean local original file

            const biodegradable = annotations.filter(d => d.type === 'Biodegradable');
            const nonBiodegradable = annotations.filter(d => d.type === 'Non-biodegradable');


            const total = annotations.length;

            // Optional: Time taken
            const timeTaken = 2.3;


            let ecoScore;
            const bioRatio = biodegradable.length / total;
            if (bioRatio >= 0.7) ecoScore = 'A';
            else if (bioRatio >= 0.4) ecoScore = 'B';
            else ecoScore = 'C';

            const detectedItems = annotations.map(d => ({
                name: d.name,
                confidence: d.confidence,
                type: d.type
            }));

            res.render('result.ejs', {
                imageUrl,
                detections: annotations,
                imageId: metadata.id,
                biodegradable,
                nonBiodegradable,
                total,
                ecoScore,
                timeTaken,
                detectedItems // ✅ added
            });


        } catch (error) {
            console.error('Error in /upload:', error);  // Improved logging
            cleanFiles(originalPath);

            // Handle Supabase-specific file size error (>50 MB)
            if (error.name === 'StorageApiError' && (error.status === 413 || error.message.includes('too large'))) {
                return res.status(400).json({ error: 'The uploaded file exceeds the 50 MB limit. Please try a smaller file.' });
            }

            res.status(500).json({ error: error.message });
        }
    });
});


   app.get('/download/:imageId', async (req, res) => {
    const { imageId } = req.params;
    try {
        // Retrieve the filename from your image_metadata table
        const { data: metadata, error: fetchError } = await supabase
            .from('image_metadata')
            .select('filename')
            .eq('id', imageId)
            .single();

        if (fetchError || !metadata) {
            return res.status(404).send('Image not found');
        }
        console.log(metadata)
        // Download the image from Supabase Storage
        const { data: fileData, error: downloadError } = await supabase.storage
            .from('annotated-images')
            .download(metadata.filename);

        if (downloadError) {
            return res.status(500).send('Error downloading image');
        }

        // Convert Blob to Buffer for Node.js
        const buffer = Buffer.from(await fileData.arrayBuffer());

        // Force download by setting headers
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Content-Disposition', `attachment; filename="${metadata.filename}"`);

        res.send(buffer);
    } catch (error) {
        console.error('Error in /download:', error);
        res.status(500).send('Server error during download');
    }
});




app.post('/delete-image', async (req, res) => {
    const { imageId } = req.body;
    try {
        const { data: metadata, error: fetchError } = await supabase
            .from('image_metadata')
            .select('filename')
            .eq('id', imageId)
            .single();
        if (fetchError || !metadata) throw new Error('Metadata not found');

        // Delete from Storage
        const { error: deleteError } = await supabase.storage
            .from('annotated-images')
            .remove([metadata.filename]);
        if (deleteError) throw deleteError;

        // Delete metadata with error handling
        const { error: metadataDeleteError } = await supabase.from('image_metadata').delete().eq('id', imageId);
        if (metadataDeleteError) throw metadataDeleteError;

        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Error in /delete-image:', error);  // Improved logging
        res.status(500).json({ error: error.message });
    }
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
            console.error('Error in /analyze:', error);  // Improved logging
            cleanFiles(originalPath);
            res.status(500).json({ error: error.message });
        }
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'OK', model: 'facebook/detr-resnet-101', apiKeySet: !!HF_API_KEY });
});

// const PORT = process.env.PORT || 3000;
// app.listen(PORT, () => {
//     console.log(`Server running on port ${PORT}`);
// });

module.exports = app
