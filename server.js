const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const session = require('express-session');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

app.use(session({
    secret: 'qc-secret-key-2026',
    resave: false,
    saveUninitialized: true
}));

// Kết nối MongoDB (Hoặc cấu hình URI của bạn)
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/qc_system', {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).catch(err => console.log('MongoDB connection error:', err));

// Schema Người dùng & Báo cáo
const UserSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true }
});
const User = mongoose.model('User', UserSchema);

const ReportSchema = new mongoose.Schema({
    data: Object,
    photos: Object,
    createdAt: { type: Date, default: Date.now }
});
const Report = mongoose.model('Report', ReportSchema);

// Cấu hình Multer lưu 18 ảnh
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname))
});
const upload = multer({ storage: storage });

// --- API XÁC THỰC ADMIN ---
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === 'Ab@123456') {
        req.session.isAdmin = true;
        res.json({ success: true });
    } else {
        res.json({ success: false, message: 'Sai tên đăng nhập hoặc mật khẩu!' });
    }
});

app.post('/api/admin/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/admin/check', (req, res) => {
    res.json({ isAdmin: !!req.session.isAdmin });
});

// --- API TẠO TÀI KHOẢN NHÂN VIÊN ---
app.post('/api/users', async (req, res) => {
    try {
        const { username, password } = req.body;
        const newUser = new User({ username, password });
        await newUser.save();
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, message: 'Tên tài khoản đã tồn tại hoặc lỗi hệ thống!' });
    }
});

// --- API GỬI BÁO CÁO TỪ NHÂN VIÊN (Nhận 18 ảnh) ---
const photoFields = [];
for (let i = 1; i <= 18; i++) {
    photoFields.push({ name: `photo_${i}`, maxCount: 1 });
}

app.post('/api/reports', upload.fields(photoFields), async (req, res) => {
    try {
        const photos = {};
        if (req.files) {
            for (let key in req.files) {
                photos[key] = '/uploads/' + req.files[key][0].filename;
            }
        }
        const newReport = new Report({
            data: req.body,
            photos: photos
        });
        await newReport.save();
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Lỗi lưu báo cáo lên máy chủ!' });
    }
});

// --- API QUẢN LÝ BÁO CÁO CHO ADMIN ---
app.get('/api/reports', async (req, res) => {
    try {
        const reports = await Report.find().sort({ createdAt: -1 });
        res.json(reports);
    } catch (err) {
        res.status(500).json([]);
    }
});

app.get('/api/reports/:id', async (req, res) => {
    try {
        const report = await Report.findById(req.params.id);
        res.json(report);
    } catch (err) {
        res.status(404).json({ success: false });
    }
});

app.delete('/api/reports/:id', async (req, res) => {
    try {
        if (!req.session.isAdmin) return res.status(403).json({ success: false, message: 'Chưa đăng nhập Admin!' });
        await Report.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));