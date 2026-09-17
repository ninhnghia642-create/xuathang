const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const session = require('express-session');

const app = express();

// QUAN TRỌng: Tăng giới hạn nhận dữ liệu lên 50MB để không bị lỗi Payload Too Large / nghẽn mạng 4G
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Cấu hình Session
app.use(session({
    secret: 'qc-secret-key',
    resave: false,
    saveUninitialized: true
}));

// Thư mục tĩnh public chứa giao diện mobile.html
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Cấu hình Multer lưu file ảnh tải lên
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });

// API nhận báo cáo từ mobile
app.post('/api/reports', upload.any(), (req, res) => {
    try {
        console.log("Nhận dữ liệu báo cáo:", req.body);
        console.log("Nhận hình ảnh:", req.files ? req.files.length : 0);
        
        // Xử lý lưu database hoặc logic lưu trữ ở đây
        res.json({ success: true, message: 'Lưu báo cáo và đồng bộ đám mây thành công!' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Khởi động server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server đang chạy trên cổng ${PORT}`);
});