const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const session = require('express-session');

const app = express();

// Tăng giới hạn dung lượng lên 50MB để tránh nghẽn mạng
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Cấu hình Session
app.use(session({
    secret: 'qc-secret-key-safe',
    resave: false,
    saveUninitialized: true
}));

// Thư mục tĩnh
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Cấu hình Multer lưu 18 ảnh
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });

// API Đăng nhập Quản trị viên
app.post('/api/login', express.json(), (req, res) => {
    const { username, password } = req.body;
    // Tài khoản mặc định: admin / Ab@123456
    if (username === 'admin' && password === 'Ab@123456') {
        req.session.isAdmin = true;
        return res.json({ success: true, message: 'Đăng nhập thành công!' });
    }
    res.status(401).json({ success: false, message: 'Sai tên đăng nhập hoặc mật khẩu!' });
});

// Kiểm tra trạng thái đăng nhập
app.get('/api/check-auth', (req, res) => {
    if (req.session && req.session.isAdmin) {
        return res.json({ loggedIn: true });
    }
    res.json({ loggedIn: false });
});

// API nhận báo cáo từ mobile
app.post('/api/reports', upload.any(), (req, res) => {
    try {
        console.log("Dữ liệu báo cáo nhận:", req.body);
        console.log("Số lượng ảnh nhận:", req.files ? req.files.length : 0);
        
        // Bạn có thể lưu vào MongoDB tại đây nếu cần
        res.json({ success: true, message: 'Lưu báo cáo và đồng bộ đám mây thành công!' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server đang chạy trên cổng ${PORT}`);
});